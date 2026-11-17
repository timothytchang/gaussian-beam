/**
 * Original, dependency-free paraxial Gaussian / second-moment beam model.
 * Lengths are mm; wavelengthNm is the vacuum wavelength in nm.
 * q = distance from waist + i zR; 1/q = 1/R - i M² λ0/(π n w²).
 * w is the 1/e² intensity radius for a Gaussian; for general M² beams it
 * denotes 2σ (half the D4σ diameter). Independent x/y axes, no rotated optics.
 * Ray matrices act on (height, angle), not (height, n × angle).
 * References: RP Photonics Encyclopedia, Dr. Rüdiger Paschotta,
 * https://www.rp-photonics.com/abcd_matrix.html
 * https://www.rp-photonics.com/gaussian_beams.html
 * https://www.rp-photonics.com/m2_factor.html
 */
const MAX_Z = 1e7;
const TYPES = new Set(['lens', 'cylindrical', 'mirror', 'flat', 'interface', 'slab', 'abcd']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const copyQ = q => ({ re: q.re, im: q.im });
const clone = value => JSON.parse(JSON.stringify(value));
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
}
function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be a finite number from ${min} to ${max}.`);
  return value;
}
function text(value, name, max = 120) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters.`);
  return value;
}
function nonzero(value, name) {
  number(value, name, -1e9, 1e9);
  if (Math.abs(value) < 1e-6) throw new Error(`${name} must have magnitude at least 0.000001 mm.`);
  return value;
}
function refractive(value, name) { return number(value, name, 0.1, 10); }
function nullablePower(value, name) { return value === null ? null : nonzero(value, name); }

/** Return a sanitized, detached configuration; throw on malformed input. */
export function validateConfig(raw) {
  object(raw, 'Design');
  if (raw.version !== 1) throw new Error('Unsupported design version; expected version 1.');
  object(raw.input, 'Input beam');
  const c = {
    version: 1,
    name: text(raw.name ?? 'Untitled beam', 'Design name'),
    wavelengthNm: number(raw.wavelengthNm, 'Vacuum wavelength', 1, 1e7),
    m2: number(raw.m2, 'M²', 1, 1000),
    n: refractive(raw.n, 'Input index'),
    input: {
      wx: number(raw.input.wx, 'X waist radius', 1e-8, 1e5),
      wy: number(raw.input.wy, 'Y waist radius', 1e-8, 1e5),
      zx: number(raw.input.zx, 'X waist position', -MAX_Z, MAX_Z),
      zy: number(raw.input.zy, 'Y waist position', -MAX_Z, MAX_Z),
    },
    end: number(raw.end, 'Bench length', 1e-6, MAX_Z),
    optics: [],
  };
  if (!Array.isArray(raw.optics) || raw.optics.length > 200) throw new Error('Optics must be an array of at most 200 elements.');
  const ids = new Set();
  for (const [i, rawOptic] of raw.optics.entries()) {
    object(rawOptic, `Optic ${i + 1}`);
    const id = text(rawOptic.id, `Optic ${i + 1} ID`, 100);
    if (!id || ids.has(id)) throw new Error('Every optic needs a unique, nonempty ID.');
    ids.add(id);
    if (!TYPES.has(rawOptic.type)) throw new Error(`Unknown optic type: ${String(rawOptic.type).slice(0, 40)}.`);
    if (own(rawOptic, 'enabled') && typeof rawOptic.enabled !== 'boolean') throw new Error(`Optic ${i + 1} enabled must be true or false.`);
    const e = {
      id, type: rawOptic.type,
      label: text(rawOptic.label ?? rawOptic.type, 'Optic label'),
      z: number(rawOptic.z, `${id} position`, 0, c.end),
      enabled: rawOptic.enabled !== false,
    };
    switch (e.type) {
      case 'lens': e.f = nonzero(rawOptic.f, `${id} focal length`); break;
      case 'cylindrical':
        e.fx = nullablePower(rawOptic.fx, `${id} X focal length`);
        e.fy = nullablePower(rawOptic.fy, `${id} Y focal length`);
        break;
      case 'mirror': e.radius = nonzero(rawOptic.radius, `${id} mirror radius`); break;
      case 'interface':
        e.nOut = refractive(rawOptic.nOut, `${id} output index`);
        e.radius = nullablePower(rawOptic.radius, `${id} surface radius`);
        break;
      case 'slab':
        e.nSlab = refractive(rawOptic.nSlab, `${id} slab index`);
        e.thickness = number(rawOptic.thickness, `${id} thickness`, 1e-6, MAX_Z);
        if (e.z + e.thickness > c.end) throw new Error(`${id} extends beyond the bench.`);
        break;
      case 'abcd':
        for (const key of ['A', 'B', 'C', 'D']) e[key] = number(rawOptic[key], `${id} ${key}`, -1e12, 1e12);
        if (own(rawOptic, 'nOut')) e.nOut = refractive(rawOptic.nOut, `${id} output index`);
        break;
    }
    c.optics.push(e);
  }
  // ECMAScript's stable sort preserves the declared order at coincident planes.
  c.optics.sort((a, b) => a.z - b.z);
  let index = c.n;
  let occupiedUntil = -1;
  for (const e of c.optics.filter(e => e.enabled)) {
    if (e.z < occupiedUntil) throw new Error(`${e.label || e.id} overlaps a slab; place optics at or beyond its exit.`);
    if (e.type === 'slab') occupiedUntil = e.z + e.thickness;
    if (e.type === 'abcd') {
      const expected = index / (e.nOut ?? index);
      const determinant = e.A * e.D - e.B * e.C;
      if (!(determinant > 0) || Math.abs(determinant - expected) > 1e-8 * expected)
        throw new Error(`${e.id}: ABCD determinant must equal nIn/nOut (${expected}).`);
    }
    if (e.type === 'interface' || e.type === 'abcd') index = e.nOut ?? index;
  }
  return c;
}

function transform(q, A, B, C, D) {
  const dr = C * q.re + D, di = C * q.im;
  const denom = dr * dr + di * di;
  // Compute the imaginary part through the determinant to avoid cancellation.
  const next = {
    re: ((A * q.re + B) * dr + A * q.im * di) / denom,
    im: (A * D - B * C) * q.im / denom,
  };
  if (!Number.isFinite(next.re) || !Number.isFinite(next.im) || next.im <= 0)
    throw new Error('This optical system exceeds the numerical range of the paraxial model.');
  return next;
}
function advance(state, z) {
  const distance = z - state.z;
  return { z, n: state.n, qx: { re: state.qx.re + distance, im: state.qx.im }, qy: { re: state.qy.re + distance, im: state.qy.im } };
}
function matrix(state, A, B, C, D, n = state.n, yMatrix = null) {
  return { z: state.z, n, qx: transform(state.qx, A, B, C, D), qy: transform(state.qy, ...(yMatrix ?? [A, B, C, D])) };
}
function surface(state, nOut, radius = null) {
  const C = radius === null ? 0 : (state.n - nOut) / (radius * nOut);
  return matrix(state, 1, 0, C, state.n / nOut, nOut);
}
function apply(state, e) {
  switch (e.type) {
    case 'lens': return matrix(state, 1, 0, -1 / e.f, 1);
    case 'cylindrical': return matrix(state, 1, 0, e.fx === null ? 0 : -1 / e.fx, 1, state.n, [1, 0, e.fy === null ? 0 : -1 / e.fy, 1]);
    case 'mirror': return matrix(state, 1, 0, -2 / e.radius, 1);
    case 'interface': return surface(state, e.nOut, e.radius);
    case 'abcd': return matrix(state, e.A, e.B, e.C, e.D, e.nOut ?? state.n);
    default: return state;
  }
}
function readout(c, state) {
  const factor = c.m2 * c.wavelengthNm * 1e-6 / (Math.PI * state.n);
  const axis = q => ({
    w: Math.sqrt(factor * q.im) * Math.hypot(1, q.re / q.im),
    radius: q.re === 0 ? Infinity : q.re + q.im * (q.im / q.re),
    waist: Math.sqrt(factor * q.im),
    waistZ: state.z - q.re,
  });
  const x = axis(state.qx), y = axis(state.qy);
  if (![x.w, y.w, x.waist, y.waist, x.waistZ, y.waistZ].every(Number.isFinite))
    throw new Error('Beam parameters exceed the numerical range.');
  return {
    z: state.z, n: state.n, qx: copyQ(state.qx), qy: copyQ(state.qy),
    wX: x.w, wY: y.w, rX: x.radius, rY: y.radius,
    waistX: x.waist, waistY: y.waist, waistZX: x.waistZ, waistZY: y.waistZ,
    rayleighX: state.qx.im, rayleighY: state.qy.im,
    divergenceX: factor / x.waist, divergenceY: factor / y.waist,
  };
}
function compile(c) {
  const k = Math.PI * c.n / (c.m2 * c.wavelengthNm * 1e-6);
  let state = { z: 0, n: c.n, qx: { re: -c.input.zx, im: k * c.input.wx ** 2 }, qy: { re: -c.input.zy, im: k * c.input.wy ** 2 } };
  const initial = state, segments = [], elements = [], boundaries = [];
  function propagate(z) {
    if (z > state.z) segments.push({ start: state.z, end: z, n: state.n, qx: copyQ(state.qx), qy: copyQ(state.qy) });
    state = advance(state, z);
  }
  for (const optic of c.optics.filter(e => e.enabled)) {
    propagate(optic.z);
    const before = readout(c, state);
    if (optic.type === 'slab') {
      const surrounding = state.n;
      state = surface(state, optic.nSlab);
      boundaries.push({ z: state.z, state });
      propagate(optic.z + optic.thickness);
      state = surface(state, surrounding);
    } else state = apply(state, optic);
    const after = readout(c, state);
    boundaries.push({ z: state.z, state });
    elements.push({ id: optic.id, type: optic.type, label: optic.label, z: optic.z, zEnd: state.z, before, after, optic });
  }
  propagate(c.end);
  return { initial, final: state, segments, elements, boundaries };
}
function stateAt(model, z) {
  // Walk boundaries in declared order, then propagate in the current medium.
  let state = model.initial;
  for (const boundary of model.boundaries) {
    if (boundary.z > z) break;
    state = boundary.state;
  }
  return advance(state, z);
}

/** Read beam parameters immediately after all elements at position z. */
export function at(raw, z) {
  const c = validateConfig(raw);
  number(z, 'Probe position', 0, c.end);
  return readout(c, stateAt(compile(c), z));
}

/** Samples include exact waists within each homogeneous segment. */
export function trace(raw) {
  const c = validateConfig(raw), model = compile(c);
  const samples = [];
  for (const segment of model.segments) {
    const count = Math.max(4, Math.ceil(700 * (segment.end - segment.start) / c.end));
    const positions = Array.from({ length: count + 1 }, (_, i) => segment.start + (segment.end - segment.start) * i / count);
    for (const q of [segment.qx, segment.qy]) {
      const waist = segment.start - q.re;
      if (waist > segment.start && waist < segment.end) positions.push(waist);
    }
    positions.sort((a, b) => a - b);
    for (const z of positions) samples.push(readout(c, advance({ z: segment.start, n: segment.n, qx: segment.qx, qy: segment.qy }, z)));
  }
  // Samples at interfaces may share z; last sample carries the post-optic state.
  samples.push(readout(c, model.final));
  return { samples, segments: model.segments, elements: model.elements };
}

// Deterministic bounded Nelder–Mead; 1–2 parameters only, no global guarantee.
function minimize(fn, start, bounds, steps, maxIterations = 350) {
  const clamp = p => p.map((v, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], v)));
  const evaluate = p => { const point = clamp(p); return { p: point, f: fn(point) }; };
  let simplex = [evaluate(start)];
  for (let i = 0; i < start.length; i++) {
    const p = [...start];
    p[i] += p[i] + steps[i] <= bounds[i][1] ? steps[i] : -steps[i];
    simplex.push(evaluate(p));
  }
  let iteration = 0;
  for (; iteration < maxIterations; iteration++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex.at(-1), secondWorst = simplex.at(-2);
    if (simplex.every(v => v.p.every((x, i) => Math.abs(x - best.p[i]) <= 1e-10 * Math.max(1, Math.abs(best.p[i]))))) break;
    const center = best.p.map((_, i) => simplex.slice(0, -1).reduce((s, v) => s + v.p[i], 0) / start.length);
    const reflect = evaluate(center.map((x, i) => 2 * x - worst.p[i]));
    if (reflect.f < best.f) {
      const expand = evaluate(center.map((x, i) => 3 * x - 2 * worst.p[i]));
      simplex[simplex.length - 1] = expand.f < reflect.f ? expand : reflect;
    } else if (reflect.f < secondWorst.f) simplex[simplex.length - 1] = reflect;
    else {
      const outside = reflect.f < worst.f;
      const contract = evaluate(center.map((x, i) => x + 0.5 * ((outside ? reflect.p[i] : worst.p[i]) - x)));
      if (contract.f < (outside ? reflect.f : worst.f)) simplex[simplex.length - 1] = contract;
      else simplex = [best, ...simplex.slice(1).map(v => evaluate(v.p.map((x, i) => (x + best.p[i]) / 2)))];
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return { ...simplex[0], iterations: iteration, converged: iteration < maxIterations };
}
function solve3(matrix, rhs) {
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    for (let j = k + 1; j < 3; j++) if (Math.abs(rows[j][k]) > Math.abs(rows[pivot][k])) pivot = j;
    if (Math.abs(rows[pivot][k]) < 1e-14) return null;
    [rows[k], rows[pivot]] = [rows[pivot], rows[k]];
    const scale = rows[k][k];
    for (let j = k; j < 4; j++) rows[k][j] /= scale;
    for (let i = 0; i < 3; i++) if (i !== k) {
      const factor = rows[i][k];
      for (let j = k; j < 4; j++) rows[i][j] -= factor * rows[k][j];
    }
  }
  return rows.map(row => row[3]);
}

/** Unweighted least squares in measured radius, with n and M² fixed. */
export function fitBeam(points, wavelengthNm, n = 1, m2 = 1) {
  number(wavelengthNm, 'Vacuum wavelength', 1, 1e7);
  refractive(n, 'Fit index'); number(m2, 'M²', 1, 1000);
  if (!Array.isArray(points) || points.length < 3 || points.length > 10000) throw new Error('Fit requires 3–10000 measured radii.');
  const data = points.map((p, i) => {
    object(p, `Measurement ${i + 1}`);
    return { z: number(p.z, 'Measurement z', -MAX_Z, MAX_Z), w: number(p.w, 'Measured radius', 1e-8, 1e5) };
  });
  if (new Set(data.map(p => p.z)).size < 3) throw new Error('Fit requires at least three distinct measurement positions.');
  const minZ = Math.min(...data.map(p => p.z)), maxZ = Math.max(...data.map(p => p.z));
  const center = (minZ + maxZ) / 2, span = (maxZ - minZ) / 2;
  const minW = Math.min(...data.map(p => p.w)), maxW = Math.max(...data.map(p => p.w));
  const K = m2 * wavelengthNm * 1e-6 / (Math.PI * n);
  const normalized = data.map(p => ({ t: (p.z - center) / span, w: p.w }));
  const bounds = [[Math.log(1e-8), Math.log(Math.min(1e5, maxW * 3))], [(-MAX_Z - center) / span, (MAX_Z - center) / span]];
  const objective = ([logW, t0]) => {
    const w0 = Math.exp(logW);
    return normalized.reduce((sum, p) => sum + ((Math.hypot(w0, K * span * (p.t - t0) / w0) - p.w) / maxW) ** 2, 0) / data.length;
  };
  const normal = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = [0, 0, 0];
  for (const p of normalized) {
    const row = [p.t ** 2, p.t, 1];
    for (let i = 0; i < 3; i++) {
      rhs[i] += row[i] * p.w ** 2;
      for (let j = 0; j < 3; j++) normal[i][j] += row[i] * row[j];
    }
  }
  const polynomial = solve3(normal, rhs), starts = [];
  if (polynomial && polynomial[0] > 0) starts.push([Math.log(K * span / Math.sqrt(polynomial[0])), -polynomial[1] / (2 * polynomial[0])]);
  for (const scale of [0.1, 0.5, 1, 2]) for (const t0 of [-1, 0, 1]) starts.push([Math.log(minW * scale), t0]);
  let best = null;
  for (const start of starts) {
    const fit = minimize(objective, start, bounds, [0.25, 0.25], 600);
    if (!best || fit.f < best.f) best = fit;
  }
  const w0 = Math.exp(best.p[0]), z0 = center + span * best.p[1], rayleigh = w0 ** 2 / K;
  const fitted = data.map(p => {
    const w = Math.hypot(w0, K * (p.z - z0) / w0);
    return { z: p.z, w, measured: p.w, residual: w - p.w };
  });
  return { w0, z0, rmse: Math.sqrt(fitted.reduce((sum, p) => sum + p.residual ** 2, 0) / data.length), rayleigh, divergence: K / w0, fitted, iterations: best.iterations, converged: best.converged };
}

/**
 * Move one or two lenses to match a circular waist at targetZ.
 * bounds is [[minZ,maxZ], ...] in lensIds order, default [0,targetZ].
 * Returns a detached best feasible design. The search is bounded/multistart,
 * not a proof of global optimality. overlap is an ideal-Gaussian mode metric;
 * it does not establish coupling efficiency for a non-Gaussian M² beam.
 */
export function matchWaist(raw, options) {
  const c = validateConfig(raw);
  object(options, 'Match options');
  const targetZ = number(options.targetZ, 'Target position', 0, c.end);
  const targetW = number(options.targetW, 'Target radius', 1e-8, 1e5);
  const lensIds = options.lensIds;
  if (!Array.isArray(lensIds) || lensIds.length < 1 || lensIds.length > 2 || new Set(lensIds).size !== lensIds.length)
    throw new Error('Select one or two distinct lenses to move.');
  const lenses = lensIds.map(id => c.optics.find(e => e.id === id));
  if (lenses.some(e => !e || !e.enabled || !['lens', 'cylindrical'].includes(e.type))) throw new Error('Matching requires enabled thin or cylindrical lenses.');
  const bounds = options.bounds ?? lensIds.map(() => [0, targetZ]);
  if (!Array.isArray(bounds) || bounds.length !== lensIds.length) throw new Error('Supply one position bound per lens.');
  bounds.forEach((b, i) => {
    if (!Array.isArray(b) || b.length !== 2) throw new Error('Each position bound must be [minimum, maximum].');
    number(b[0], 'Minimum position', 0, targetZ); number(b[1], 'Maximum position', 0, targetZ);
    if (b[0] >= b[1]) throw new Error(`Lens ${i + 1} needs a nonzero position range.`);
  });
  let evaluations = 0;
  const candidate = positions => {
    const design = clone(c);
    lensIds.forEach((id, i) => { design.optics.find(e => e.id === id).z = positions[i]; });
    return design;
  };
  function evaluate(normalized, full = false) {
    evaluations++;
    const positions = normalized.map((v, i) => bounds[i][0] + v * (bounds[i][1] - bounds[i][0]));
    try {
      const design = validateConfig(candidate(positions)), achieved = at(design, targetZ);
      const zr = Math.PI * achieved.n * targetW ** 2 / (c.m2 * c.wavelengthNm * 1e-6);
      const overlap = [achieved.qx, achieved.qy].reduce((value, q) => value * 2 * Math.sqrt(q.im * zr) / Math.hypot(q.re, q.im + zr), 1);
      const residual = Math.sqrt([achieved.qx, achieved.qy].reduce((sum, q) => sum + (q.re / zr) ** 2 + (q.im / zr - 1) ** 2, 0) / 2);
      if (full) return { config: design, positions: lensIds.map((id, i) => ({ id, z: positions[i] })), residual, overlap: Math.min(1, overlap), achieved };
      // Stable log cost preserves precision close to unit overlap.
      return [achieved.qx, achieved.qy].reduce((sum, q) => sum + 0.5 * Math.log1p((q.re ** 2 + (q.im - zr) ** 2) / (4 * q.im * zr)), 0);
    } catch { return full ? null : Infinity; }
  }
  const steps = lenses.length === 1 ? 40 : 12, seeds = [];
  for (let i = 0; i <= steps; i++) {
    if (lenses.length === 1) seeds.push({ p: [i / steps], f: evaluate([i / steps]) });
    else for (let j = 0; j <= steps; j++) seeds.push({ p: [i / steps, j / steps], f: evaluate([i / steps, j / steps]) });
  }
  const initial = lenses.map((e, i) => Math.max(0, Math.min(1, (e.z - bounds[i][0]) / (bounds[i][1] - bounds[i][0]))));
  seeds.push({ p: initial, f: evaluate(initial) });
  seeds.sort((a, b) => a.f - b.f);
  if (!Number.isFinite(seeds[0].f)) throw new Error('No feasible lens positions were found within these bounds.');
  let best = seeds[0];
  for (const seed of seeds.slice(0, 12)) {
    const result = minimize(evaluate, seed.p, lenses.map(() => [0, 1]), lenses.map(() => 0.025), 500);
    if (result.f < best.f) best = result;
  }
  const result = evaluate(best.p, true);
  return { ...result, converged: result.residual < 1e-5, evaluations };
}
