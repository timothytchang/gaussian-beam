import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, at, trace, fitBeam, matchWaist } from './optics.mjs';

const base = overrides => ({ version: 1, name: 'Test', wavelengthNm: 1000, m2: 1, n: 1,
  input: { wx: 0.2, wy: 0.3, zx: 0, zy: 20 }, end: 1000, optics: [], ...overrides });
const near = (actual, expected, relative = 1e-10, absolute = 1e-12) => assert.ok(
  Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
const lens = (id, z, f) => ({ id, type: 'lens', label: id, enabled: true, z, f });

// Independent closed-form references: RP Photonics Gaussian Beams, w(z), zR,
// and wavefront-curvature equations; ABCD Matrix, thin-lens/free-space matrices.
test('free propagation at three wavelengths and nonzero astigmatic waist positions', () => {
  for (const wavelengthNm of [355, 780, 1550]) {
    const c = base({ wavelengthNm, m2: 1.4, n: 1.5 });
    for (const z of [0, 20, 1000]) {
      const r = at(c, z);
      for (const [axis, w0, z0] of [['X', .2, 0], ['Y', .3, 20]]) {
        const zr = Math.PI * 1.5 * w0 ** 2 / (1.4 * wavelengthNm * 1e-6);
        near(r[`w${axis}`], w0 * Math.sqrt(1 + ((z - z0) / zr) ** 2));
        near(r[`waist${axis}`], w0);
        near(r[`waistZ${axis}`], z0);
        near(r[`rayleigh${axis}`], zr);
        if (z === z0) assert.equal(r[`r${axis}`], Infinity);
        else near(r[`r${axis}`], (z - z0) * (1 + (zr / (z - z0)) ** 2));
      }
    }
  }
});

test('thin lens at an input waist matches closed-form focus and waist', () => {
  for (const f of [35, 150, -300]) {
    const c = base({ optics: [lens('L', 0, f)] });
    const zr = Math.PI * .2 ** 2 / .001;
    const focus = f * zr ** 2 / (f ** 2 + zr ** 2);
    const waist = .2 * Math.abs(f) / Math.sqrt(f ** 2 + zr ** 2);
    const r = at(c, 0);
    near(r.waistZX, focus); near(r.waistX, waist); near(r.wX, .2);
    if (focus > 0) { near(at(c, focus).wX, waist); near(at(c, focus).qx.re, 0); }
  }
});

test('cylindrical and mirror powers affect the intended axes', () => {
  const c = base({ optics: [{ id: 'C', type: 'cylindrical', z: 0, fx: 100, fy: null }] });
  const r = at(c, 100), focused = at(base({ optics: [lens('L', 0, 100)] }), 100);
  near(r.wX, focused.wX); near(r.wY, at(base(), 100).wY);
  const mirror = at(base({ optics: [{ id: 'M', type: 'mirror', z: 0, radius: 200 }] }), 100);
  near(mirror.wX, focused.wX); near(mirror.wY, focused.wY);
});

test('planar refraction preserves spot radius and changes physical Rayleigh length', () => {
  for (const nOut of [.8, 1.5, 2.4]) {
    const before = at(base(), 70);
    const c = base({ optics: [{ id: 'I', type: 'interface', z: 70, nOut, radius: null }] });
    const after = at(c, 70);
    near(after.wX, before.wX); near(after.wY, before.wY);
    near(after.qx.re, before.qx.re * nOut); near(after.qx.im, before.qx.im * nOut);
    assert.equal(after.n, nOut);
  }
});

test('slab occupies physical distance and restores surrounding medium at exit', () => {
  const c = base({ n: 1.2, optics: [{ id: 'S', type: 'slab', z: 100, nSlab: 1.8, thickness: 90 }] });
  assert.equal(at(c, 99).n, 1.2); assert.equal(at(c, 100).n, 1.8);
  assert.equal(at(c, 189).n, 1.8); assert.equal(at(c, 190).n, 1.2);
  near(at(c, 145).qx.re, 100 * 1.5 + 45);
  near(at(c, 300).qx.re, 100 + 90 / 1.5 + 110);
  near(at(c, 100).wX, at(base({ n: 1.2 }), 100).wX);
  near(at(c, 300).qx.im, at(base({ n: 1.2 }), 0).qx.im);
  assert.equal(trace(c).elements[0].after.z, 190);
  assert.ok(trace(c).segments.some(s => s.start === 100 && s.end === 190 && s.n === 1.8));
});

test('general ABCD matches a telescope and enforces index determinant', () => {
  // Two lenses f1=50,f2=100 separated by150: [ -2,150;0,-.5 ].
  const general = base({ optics: [{ id: 'A', type: 'abcd', z: 0, A: -2, B: 150, C: 0, D: -.5 }] });
  const r = at(general, 0);
  near(r.qx.re, -300); near(r.qx.im, 4 * Math.PI * .2 ** 2 / .001);
  near(r.waistX, .4); near(r.waistY, .6);
  assert.throws(() => at(base({ optics: [{ id: 'A', type: 'abcd', z: 0, A: 1, B: 0, C: 0, D: 2 }] }), 0), /determinant/);
  assert.equal(at(base({ optics: [{ id: 'A', type: 'abcd', z: 0, A: 1, B: 0, C: 0, D: .5, nOut: 2 }] }), 0).n, 2);
});

test('trace includes exact waists and agrees with probe away from boundaries', () => {
  const c = base({ optics: [lens('L', 40, 100)] }), t = trace(c);
  const focus = at(c, 40).waistZX;
  assert.ok(t.samples.some(s => Math.abs(s.z - focus) < 1e-10));
  for (const sample of t.samples.filter(s => ![40, c.end].includes(s.z)).filter((_, i) => i % 71 === 0)) near(sample.wX, at(c, sample.z).wX);
  assert.equal(t.samples.at(-1).z, c.end);
});

test('validation rejects malformed imports, overlaps, and nonfinite inputs without mutation', () => {
  for (const value of [NaN, Infinity, '780', null]) assert.throws(() => validateConfig(base({ wavelengthNm: value })));
  assert.throws(() => validateConfig(base({ version: 2 })), /version/);
  assert.throws(() => validateConfig(base({ optics: [lens('a', 0, 0)] })), /magnitude/);
  assert.throws(() => validateConfig(base({ optics: [lens('a', 0, 10), lens('a', 10, 20)] })), /unique/);
  assert.throws(() => validateConfig(base({ optics: [{ id: 'S', type: 'slab', z: 20, nSlab: 1.5, thickness: 30 }, lens('a', 40, 10)] })), /overlaps/);
  const c = base({ optics: [lens('B', 200, 20), lens('A', 100, 10)] }), snapshot = JSON.stringify(c);
  assert.equal(validateConfig(c).optics[0].id, 'A'); assert.equal(JSON.stringify(c), snapshot);
  assert.throws(() => at(c, -1), /Probe/);
  assert.throws(() => validateConfig(base({ optics: [{ id: 'x', type: '__proto__', z: 0 }] })), /Unknown/);
});

test('fit recovers exact hyperbolas across scales, including distant waists', () => {
  for (const [w0, z0, wavelengthNm, m2, n, locations] of [
    [.04, 30, 780, 1, 1, [-20, 0, 20, 50, 100]],
    [.2, -120, 1064, 1.6, 1.4, [0, 40, 80, 160, 300]],
    [1, 4500, 1550, 1, 1, [-10000, 0, 4000, 8000, 15000]],
    [.02, 5000, 780, 1, 1, [-50, -25, 0, 25, 50]],
    [.5, 10000, 780, 1, 1, [-20, -10, 0, 10, 20]],
    [.005, -3000, 780, 1, 1, [-500, -250, 0, 250, 500]],
  ]) {
    const zr = Math.PI * n * w0 ** 2 / (m2 * wavelengthNm * 1e-6);
    const points = locations.map(z => ({ z, w: w0 * Math.sqrt(1 + ((z - z0) / zr) ** 2) }));
    const fit = fitBeam(points, wavelengthNm, n, m2);
    near(fit.w0, w0, 1e-7); near(fit.z0, z0, 1e-7); assert.ok(fit.rmse < 1e-9); assert.equal(fit.converged, true);
  }
  assert.throws(() => fitBeam([{ z: 0, w: 1 }, { z: 0, w: 2 }, { z: 1, w: 3 }], 780), /distinct/);
});

test('radius fit remains useful with deterministic measurement noise', () => {
  const w0 = .12, z0 = 45, zr = Math.PI * w0 ** 2 / .00078;
  const data = [-150, -80, -20, 20, 60, 100, 160, 220].map((z, i) => ({ z, w: w0 * Math.sqrt(1 + ((z - z0) / zr) ** 2) * (1 + .003 * Math.sin(i * 2)) }));
  const fit = fitBeam(data, 780);
  assert.ok(Math.abs(fit.w0 / w0 - 1) < .005); assert.ok(Math.abs(fit.z0 - z0) < .5);
  assert.ok(fit.rmse < .001);
});

test('one-lens matcher recovers a reachable waist and preserves input', () => {
  const c = base({ input: { wx: .2, wy: .2, zx: 0, zy: 0 }, optics: [lens('L', 10, 100)] });
  const known = base({ input: c.input, optics: [lens('L', 70, 100)] }), target = at(known, 70);
  const snapshot = JSON.stringify(c);
  const result = matchWaist(c, { targetZ: target.waistZX, targetW: target.waistX, lensIds: ['L'], bounds: [[20, 120]] });
  assert.ok(result.converged); near(result.positions[0].z, 70, 1e-7); assert.ok(result.residual < 1e-6);
  near(result.overlap, 1); assert.equal(JSON.stringify(c), snapshot);
});

test('matcher reports residual for unreachable targets', () => {
  const c = base({ input: { wx: .2, wy: .2, zx: 0, zy: 0 }, optics: [lens('L', 10, -100)] });
  const result = matchWaist(c, { targetZ: 500, targetW: .01, lensIds: ['L'], bounds: [[0, 300]] });
  assert.equal(result.converged, false); assert.ok(result.residual > .01); assert.ok(result.overlap < .99);
  assert.ok(result.positions[0].z >= 0 && result.positions[0].z <= 300);
});
