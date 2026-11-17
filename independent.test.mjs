import test from 'node:test';
import assert from 'node:assert/strict';
import { at, fitBeam, matchWaist, validateConfig } from './optics.mjs';

// Independent reference: propagate two rms ray basis vectors, never complex q.
// Their outer products give the beam covariance S. At a waist, sigma_x=w0/2
// and sigma_theta=M²*lambda_vac/(2*pi*n*w0). Geometric rays obey x'=x+d*theta;
// a lens changes theta by -x/f, and refraction follows linearized Snell's law.
// Only final comparison converts S to q=(S_xθ+i*sqrt(det S))/S_θθ.
const reference = (config, stop) => {
  const { wavelengthNm, m2, input } = config;
  const lambda = wavelengthNm * 1e-6;
  let n = config.n;
  let position = 0;
  const rays = (w, waistZ) => {
    const slope = m2 * lambda / (2 * Math.PI * n * w);
    return [[w / 2, 0], [-waistZ * slope, slope]];
  };
  const x = rays(input.wx, input.zx);
  const y = rays(input.wy, input.zy);
  const translate = distance => {
    for (const ray of [...x, ...y]) ray[0] += distance * ray[1];
  };
  const kick = (axis, power) => {
    for (const ray of axis) ray[1] -= power * ray[0];
  };
  const refract = (nextN, radius = null) => {
    for (const ray of [...x, ...y]) {
      ray[1] = (n * ray[1] - (radius === null ? 0 : (nextN - n) * ray[0] / radius)) / nextN;
    }
    n = nextN;
  };
  const elements = config.optics.filter(o => o.enabled !== false).toSorted((a, b) => a.z - b.z);
  for (const o of elements) {
    if (o.z > stop) break;
    translate(o.z - position);
    position = o.z;
    if (o.type === 'lens') {
      kick(x, 1 / o.f); kick(y, 1 / o.f);
    } else if (o.type === 'cylindrical') {
      kick(x, o.fx === null ? 0 : 1 / o.fx);
      kick(y, o.fy === null ? 0 : 1 / o.fy);
    } else if (o.type === 'mirror') {
      kick(x, 2 / o.radius); kick(y, 2 / o.radius);
    } else if (o.type === 'interface') {
      refract(o.nOut, o.radius);
    } else if (o.type === 'slab') {
      const ambient = n;
      refract(o.nSlab);
      const distance = Math.min(stop - o.z, o.thickness);
      translate(distance);
      position += distance;
      if (stop < o.z + o.thickness) break;
      refract(ambient);
    } else if (o.type === 'abcd') {
      for (const ray of [...x, ...y]) {
        const [offset, angle] = ray;
        ray[0] = o.A * offset + o.B * angle;
        ray[1] = o.C * offset + o.D * angle;
      }
      n = o.nOut ?? n;
    } else if (o.type !== 'flat') {
      throw new Error(`Reference cannot interpret ${o.type}`);
    }
  }
  translate(stop - position);
  const read = axis => {
    const xx = axis.reduce((sum, ray) => sum + ray[0] ** 2, 0);
    const xt = axis.reduce((sum, ray) => sum + ray[0] * ray[1], 0);
    const tt = axis.reduce((sum, ray) => sum + ray[1] ** 2, 0);
    // Compute the determinant through the basis area to avoid cancellation.
    const epsilon = Math.abs(axis[0][0] * axis[1][1] - axis[1][0] * axis[0][1]);
    return { w: 2 * Math.sqrt(xx), re: xt / tt, im: epsilon / tt,
      waistZ: stop - xt / tt, waistW: 2 * epsilon / Math.sqrt(tt) };
  };
  return { x: read(x), y: read(y), n };
};

const setup = (changes = {}) => ({
  version: 1, name: 'Independent physics check', wavelengthNm: 780, m2: 1, n: 1,
  input: { wx: 0.2, wy: 0.2, zx: 0, zy: 0 }, end: 800, optics: [], ...changes,
});
const optic = (type, z, properties = {}) => ({
  id: `${type}-${z}`, type, label: type, z, enabled: true, ...properties,
});
const close = (actual, expected, label, relative = 3e-11, absolute = 3e-11) => {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected),
    `${label}: expected ${expected}, received ${actual}`);
};
const compare = (config, z) => {
  // Compute expectations before invoking the code under test.
  const expected = reference(config, z);
  const actual = at(config, z);
  close(actual.n, expected.n, 'refractive index');
  for (const [axis, qKey, wKey, waistKey, positionKey] of [
    ['x', 'qx', 'wX', 'waistX', 'waistZX'],
    ['y', 'qy', 'wY', 'waistY', 'waistZY'],
  ]) {
    close(actual[wKey], expected[axis].w, `${axis} radius at ${z}`);
    close(actual[qKey].re, expected[axis].re, `${axis} q real at ${z}`);
    close(actual[qKey].im, expected[axis].im, `${axis} q imaginary at ${z}`);
    close(actual[waistKey], expected[axis].waistW, `${axis} local waist radius at ${z}`);
    close(actual[positionKey], expected[axis].waistZ, `${axis} local waist position at ${z}`);
  }
};

test('closed-form propagation spans wavelength, index, waist, and M²', () => {
  for (const p of [
    { wavelengthNm: 405, n: 1, m2: 1, w: 0.025, z0: 20 },
    { wavelengthNm: 780, n: 1.5, m2: 1.3, w: 0.1, z0: -35 },
    { wavelengthNm: 1550, n: 1.33, m2: 2.1, w: 0.5, z0: 140 },
  ]) {
    const config = setup({ wavelengthNm: p.wavelengthNm, n: p.n, m2: p.m2,
      input: { wx: p.w, wy: p.w, zx: p.z0, zy: p.z0 } });
    const rayleigh = Math.PI * p.n * p.w ** 2 / (p.m2 * p.wavelengthNm * 1e-6);
    for (const z of [0, 80, 600]) {
      const expected = p.w * Math.hypot(1, (z - p.z0) / rayleigh);
      const result = at(config, z);
      close(result.wX, expected, 'analytic radius');
      close(result.qx.re, z - p.z0, 'analytic q real');
      close(result.qx.im, rayleigh, 'analytic Rayleigh length');
      compare(config, z);
    }
  }
});

test('lens and unfolded mirror have the exact f=zR waist image', () => {
  const waist = Math.sqrt(0.1 / Math.PI);
  for (const element of [optic('lens', 0, { f: 100 }), optic('mirror', 0, { radius: 200 })]) {
    const config = setup({ wavelengthNm: 1000, input: { wx: waist, wy: waist, zx: 0, zy: 0 }, optics: [element] });
    const result = at(config, 50);
    close(result.qx.re, 0, 'new waist location');
    close(result.qx.im, 50, 'new Rayleigh length');
    close(result.wX, waist / Math.SQRT2, 'new waist radius');
  }
});

test('independent covariance propagation through three optical systems', () => {
  const cases = [
    setup({ input: { wx: 0.18, wy: 0.31, zx: -40, zy: 70 }, optics: [
      optic('lens', 80, { f: 125 }), optic('cylindrical', 180, { fx: -200, fy: null }),
      optic('mirror', 320, { radius: 600 }), optic('flat', 410),
    ] }),
    setup({ wavelengthNm: 532, n: 1.2, m2: 1.4,
      input: { wx: 0.07, wy: 0.12, zx: 15, zy: -20 }, optics: [
        optic('slab', 30, { nSlab: 1.8, thickness: 90 }),
        optic('lens', 170, { f: -80 }), optic('slab', 250, { nSlab: 1.45, thickness: 20 }),
    ] }),
    setup({ wavelengthNm: 1064, m2: 2.3,
      input: { wx: 0.4, wy: 0.22, zx: -100, zy: 45 }, optics: [
        optic('interface', 25, { nOut: 1.5, radius: 75 }),
        optic('interface', 80, { nOut: 1.1, radius: -120 }),
        optic('abcd', 120, { A: 1.5, B: 30, C: 0, D: 2 / 3, nOut: 1.1 }),
        optic('abcd', 200, { A: 1, B: 0, C: -0.002, D: 1.1 / 1.4, nOut: 1.4 }),
    ] }),
  ];
  for (const config of cases) {
    validateConfig(config);
    for (const z of [0, 25, 30, 50, 80, 119, 120, 180, 200, 260, 270, 420, 750]) compare(config, z);
  }
});

test('plane slab has effective distance t*nAmbient/nSlab and continuous radius', () => {
  const config = setup({ n: 1.2, optics: [optic('slab', 100, { nSlab: 1.8, thickness: 90 })] });
  // At z=300, the ambient equivalent distance is 100+90*(1.2/1.8)+110=270 mm.
  const rayleigh = Math.PI * 1.2 * 0.2 ** 2 / 0.000780;
  const after = at(config, 300);
  close(after.qx.re, 270, 'slab effective distance');
  close(after.qx.im, rayleigh, 'slab preserves ambient Rayleigh length');
  for (const z of [100, 145, 190]) compare(config, z);
  for (const z of [100, 190]) {
    close(at(config, z - 1e-8).wX, at(config, z).wX, 'radius continuity', 1e-8, 1e-10);
  }
});

test('cylindrical null focal length, disabled optics, and flat mirror preserve the free axis', () => {
  const config = setup({ optics: [
    optic('cylindrical', 100, { fx: 150, fy: null }), optic('flat', 180),
    optic('lens', 220, { f: 20, enabled: false }),
  ] });
  const z = 450;
  const expected = reference(setup(), z);
  const result = at(config, z);
  close(result.wY, expected.y.w, 'unchanged y radius');
  close(result.qy.re, expected.y.re, 'unchanged y q');
  compare(config, z);
});

test('fitBeam reproduces independently generated free-space measurements at three scales', () => {
  for (const p of [
    { wavelengthNm: 405, n: 1, m2: 1, w: 0.035, z0: -12 },
    { wavelengthNm: 780, n: 1.5, m2: 1.7, w: 0.12, z0: 230 },
    { wavelengthNm: 1550, n: 1.33, m2: 2.2, w: 0.45, z0: 1400 },
  ]) {
    const angle = p.m2 * p.wavelengthNm * 1e-6 / (Math.PI * p.n * p.w);
    const rayleigh = p.w / angle;
    const points = [-3, -1.3, -0.4, 0, 0.6, 1.5, 3].map(k => ({
      z: p.z0 + k * rayleigh, w: Math.hypot(p.w, k * rayleigh * angle),
    }));
    const result = fitBeam(points, p.wavelengthNm, p.n, p.m2);
    close(result.w0, p.w, 'fitted waist radius', 1e-6, 1e-9);
    close(result.z0, p.z0, 'fitted waist position', 1e-6, 1e-5);
    assert.ok(result.rmse < 1e-7, `fit RMSE ${result.rmse}`);
    for (const point of points) {
      const reconstructed = Math.hypot(result.w0,
        (point.z - result.z0) * p.m2 * p.wavelengthNm * 1e-6 / (Math.PI * p.n * result.w0));
      close(reconstructed, point.w, 'reconstructed measurement', 2e-6, 1e-8);
    }
  }
});

test('waist matcher reaches an independently checked 4f solution within position bounds', () => {
  const config = setup({ end: 500, optics: [
    optic('lens', 80, { id: 'a', f: 100 }), optic('lens', 320, { id: 'b', f: 100 }),
  ] });
  // A 4f relay with lenses at 100 and 300 mm maps the z=0 waist to z=400.
  const expectedW = 0.2;
  const expectedRayleigh = Math.PI * expectedW ** 2 / 0.000780;
  const result = matchWaist(config, { targetZ: 400, targetW: expectedW,
    lensIds: ['a', 'b'], bounds: [[50, 150], [250, 350]] });
  assert.equal(result.converged, true, `matcher residual ${result.residual}`);
  assert.ok(result.residual < 1e-5, `matcher residual ${result.residual}`);
  assert.ok(result.overlap > 0.99999, `matcher overlap ${result.overlap}`);
  for (const [id, low, high] of [['a', 50, 150], ['b', 250, 350]]) {
    const found = result.config.optics.find(o => o.id === id);
    assert.ok(found.z >= low && found.z <= high, `${id} outside search bounds`);
  }
  const independent = reference(result.config, 400);
  close(independent.x.re, 0, 'matched wavefront real q', 0, 0.003);
  close(independent.x.im, expectedRayleigh, 'matched Rayleigh length', 2e-5, 1e-6);
  close(independent.x.w, expectedW, 'matched radius', 2e-5, 1e-8);
  close(independent.y.w, expectedW, 'matched y radius', 2e-5, 1e-8);
  // Matching returns a proposal and must not silently move the supplied system.
  assert.deepEqual(config.optics.map(o => o.z), [80, 320]);
});
