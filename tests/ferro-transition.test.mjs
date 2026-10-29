import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tools/symmetry-demo/ferro-transition.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox);
const { model, models } = sandbox.module.exports;
const mirrorModel = models.mF1;
const vectorClose = (actual, expected, message) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Number.isFinite(value) && Math.abs(value - expected[i]) < 1e-9,
    `${message}: ${actual} != ${expected}`));
};
const apply = (sign, values) => values.map((value, i) => value * sign[i]);
const mod = value => ((value % 1) + 1) % 1;
const periodic = (a, b) => a.every((value, i) => Math.abs(mod(value - b[i] + .5) - .5) < 1e-9);

test('222 to 1 retains E and loses exactly the three C2 operations for every nonzero order parameter', () => {
  assert.equal(model.parentOrder, 4);
  assert.equal(model.childOrder, 1);
  for (let domain = 0; domain < 4; domain++) {
    assert.equal(model.stabilizer(0, domain).length, 4);
    for (const phase of [1e-15, 1e-7, .002, .125, .5, 1]) {
      assert.deepEqual(Array.from(model.stabilizer(phase, domain), operation => operation.id), ['E']);
      assert.ok(model.residual(phase, domain, 0) < 1e-12);
      if (phase >= 1e-7) for (let op = 1; op < 4; op++) assert.ok(model.residual(phase, domain, op) > 1e-8);
    }
  }
});

test('the full decorated dipole configuration has no surviving shifted twofold, mirror or inversion symmetry', () => {
  // Search all eight metric-preserving signs and all translations that can map
  // the first molecular centre to any of the other centres. This tests the
  // full decorated set, including axes displaced from the pictured origin.
  for (let domain = 0; domain < 4; domain++) {
    const parent = model.affineStabilizer(0, domain);
    assert.equal(parent.length, 4);
    assert.ok(parent.every(operation => operation.sign.reduce((a, b) => a * b, 1) === 1));
    for (const phase of [1e-7, .01, .37, 1]) {
      const child = model.affineStabilizer(phase, domain);
      assert.equal(child.length, 1);
      vectorClose(child[0].sign, [1, 1, 1], 'child identity');
      vectorClose(child[0].t, [0, 0, 0], 'no extra fractional lattice translation');
    }
  }
});

test('four domain configurations are exactly related by parent operations and have no antiparallel partner', () => {
  const domainVectors = Array.from({ length: 4 }, (_, domain) => model.domainVector(domain));
  assert.equal(new Set(domainVectors.map(vector => vector.join(','))).size, 4);
  for (let domain = 0; domain < 4; domain++) {
    assert.ok(!domainVectors.some(vector => vector.every((value, i) => Math.abs(value + domainVectors[domain][i]) < 1e-10)));
    const operation = model.operations[domain];
    for (const phase of [0, .27, 1]) {
      const original = model.configuration(phase, 0), transformed = model.configuration(phase, domain);
      for (const site of original) {
        const position = apply(operation.sign, site.position).map(mod);
        const image = transformed.find(candidate => periodic(candidate.position, position));
        assert.ok(image);
        vectorClose(image.dipole, apply(operation.sign, site.dipole), `domain ${domain} dipole image`);
      }
    }
  }
});

test('the parent dipoles cancel and the low-phase mean polarization equals q times the selected domain vector', () => {
  for (let domain = 0; domain < 4; domain++) for (const phase of [0, .17, .5, 1]) {
    const sites = model.configuration(phase, domain);
    const mean = [0, 1, 2].map(i => sites.reduce((sum, site) => sum + site.dipole[i], 0) / 4);
    vectorClose(mean, model.polarization(phase, domain), `phase ${phase}, domain ${domain}`);
    if (phase === 0) vectorClose(mean, [0, 0, 0], 'parent nonpolar');
    if (phase > 0) assert.ok(Math.hypot(...mean) > 0);
  }
});

test('the explanatory UI distinguishes Aizu domain notation, symmetry families and geometric interpolation', () => {
  assert.match(source, /3 族二重轴消失/);
  assert.match(source, /两相均无镜面、无反演中心/);
  assert.match(source, /“\/2”是该表对可重取向类型的记号/);
  assert.match(source, /不是 2 个畴，也不是 4÷2/);
  assert.match(source, /q 不是实测温度/);
  assert.match(source, /●<\/b> 上半球参考极点/);
  assert.match(source, /○<\/b> 下半球参考极点/);
  assert.match(source, /setVisible\(value\)/);
  assert.doesNotMatch(source, /(?:fetch|import)\s*\(\s*['"]https?:/);
});

test('m to 1 loses only the mirror and preserves existing in-plane polarization', () => {
  assert.equal(mirrorModel.parentOrder, 2);
  assert.equal(mirrorModel.childOrder, 1);
  assert.equal(mirrorModel.domainCount, 2);
  assert.deepEqual(Array.from(mirrorModel.operations, operation => operation.xyz), ['x,y,z', 'x,-y,z']);
  for (let domain = 0; domain < 2; domain++) {
    assert.deepEqual(Array.from(mirrorModel.stabilizer(0, domain), operation => operation.id), ['E', 'm']);
    assert.ok(mirrorModel.residual(0, domain, 1) < 1e-12);
    for (const phase of [0, 1e-15, 1e-7, .002, .27, .6, 1]) {
      const sites = mirrorModel.configuration(phase, domain);
      const mean = [0, 1, 2].map(i => sites.reduce((sum, site) => sum + site.dipole[i], 0) / sites.length);
      const expected = [.22, (domain === 0 ? 1 : -1) * phase * .55, .43];
      vectorClose(mirrorModel.polarization(phase, domain), expected, 'model polarization');
      vectorClose(mean, expected, 'mean decorated dipoles');
      assert.ok(Math.hypot(...mean) > 0, 'both phases have the chosen nonzero in-plane baseline');
      if (phase > 0) {
        assert.deepEqual(Array.from(mirrorModel.stabilizer(phase, domain), operation => operation.id), ['E']);
        assert.ok(mirrorModel.residual(phase, domain, 0) < 1e-12);
        if (phase >= 1e-7) assert.ok(mirrorModel.residual(phase, domain, 1) > 1e-8);
      }
    }
  }
});

test('the full mF1 configuration has no hidden shifted mirror, inversion or fractional translation after the transition', () => {
  for (let domain = 0; domain < 2; domain++) {
    const parent = mirrorModel.affineStabilizer(0, domain);
    assert.equal(parent.length, 2);
    assert.deepEqual(Array.from(parent, operation => operation.sign.join(',')).sort(), ['1,-1,1', '1,1,1']);
    for (const phase of [1e-7, .01, .37, 1]) {
      const child = mirrorModel.affineStabilizer(phase, domain);
      assert.equal(child.length, 1);
      vectorClose(child[0].sign, [1, 1, 1], 'low-phase identity');
      vectorClose(child[0].t, [0, 0, 0], 'no new fractional translations');
    }
  }
});

test('the two mF1 domains are related by m and reverse only the normal component', () => {
  const p0 = mirrorModel.domainVector(0), p1 = mirrorModel.domainVector(1);
  vectorClose(p1, [p0[0], -p0[1], p0[2]], 'mirror-related polarization');
  assert.ok(!p0.every((value, i) => Math.abs(value + p1[i]) < 1e-10), 'domains are not an antiparallel pair');
  for (const phase of [0, .13, .82, 1]) {
    const original = mirrorModel.configuration(phase, 0), transformed = mirrorModel.configuration(phase, 1);
    for (const site of original) {
      const position = apply([1, -1, 1], site.position).map(mod);
      const image = transformed.find(candidate => periodic(candidate.position, position));
      assert.ok(image);
      vectorClose(image.dipole, apply([1, -1, 1], site.dipole), 'mirror maps complete local dipole');
    }
  }
});

test('mF1 moves opposite charge ends relatively rather than translating the entire decorated structure', () => {
  const before = mirrorModel.configuration(0), after = mirrorModel.configuration(1);
  for (let site = 0; site < before.length; site++) {
    vectorClose(before[site].position, after[site].position, 'local dipole centre remains fixed');
    const endpoint = (item, sign) => item.position.map((value, i) => value + sign * .13 * item.dipole[i]);
    const plusBefore = endpoint(before[site], 1), plusAfter = endpoint(after[site], 1);
    const minusBefore = endpoint(before[site], -1), minusAfter = endpoint(after[site], -1);
    const plusDisplacement = plusAfter.map((value, i) => value - plusBefore[i]);
    const minusDisplacement = minusAfter.map((value, i) => value - minusBefore[i]);
    vectorClose(plusDisplacement, [0, .13 * .55, 0], 'positive charge displacement');
    vectorClose(minusDisplacement, [0, -.13 * .55, 0], 'negative charge displacement');
  }
});
