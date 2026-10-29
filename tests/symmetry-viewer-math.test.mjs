import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [template, catalogText] = await Promise.all([
  readFile(new URL("tools/symmetry-demo/gallery-template.html", root), "utf8"),
  readFile(new URL("public/symmetry-demo/catalog.json", root), "utf8"),
]);
const catalog = JSON.parse(catalogText);

// Exercise the shipped client functions; expected endpoints below are computed
// independently from each exact fractional affine map and the cell basis.
const helpers = template.slice(template.indexOf("  const add="), template.indexOf("  const integerExamples="));
const transforms = template.slice(template.indexOf("  function rotate("), template.indexOf("  function explain("));
const viewer = new Function(`${helpers}\nlet count=1;const repetitions=()=>count;${transforms}\nreturn {transformOnce,transform,coordinateFormula,setRepetitions:n=>count=n};`)();
const classifications = template.slice(template.indexOf("  function categoryOf("), template.indexOf("  const families="));
const classify = new Function(`${classifications}\nreturn {categoryOf,categoryLabel,polarityText};`)();
const seedPoints = [[.173, .287, .219], [.412, -.291, .583], [-.371, .119, .827], [.091, .733, -.167]];
const product = (matrix, vector) => matrix.map((row) => row.reduce((sum, n, i) => sum + n * vector[i], 0));
const affine = (operation, point) => product(operation.R, point).map((n, i) => n + operation.t[i]);
const close = (actual, expected, label) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    assert.ok(Number.isFinite(actual[i]) && Math.abs(actual[i] - expected[i]) < 1e-8,
      `${label} coordinate ${i}: ${actual[i]} != ${expected[i]}`);
  }
};

test("the client animation reaches every exact affine endpoint and composed endpoint", () => {
  let operationCount = 0;
  for (const group of catalog.groups) {
    for (const operation of group.operations) {
      operationCount += 1;
      const label = `No.${group.id} operation ${operation.id} ${operation.kind}`;
      for (const point of seedPoints) {
        const cart = product(group.A, point);
        close(viewer.transformOnce(cart, operation, 0), cart, `${label} start`);
        close(viewer.transformOnce(cart, operation, 1), product(group.A, affine(operation, point)), `${label} end`);
        viewer.setRepetitions(2);
        close(viewer.transform(cart, operation, .5), product(group.A, affine(operation, point)), `${label} first end`);
        close(viewer.transform(cart, operation, 1), product(group.A, affine(operation, affine(operation, point))), `${label} composed end`);
        for (const phase of [0, .17, .25, .5, .67, .75, 1]) {
          assert.ok(viewer.transform(cart, operation, phase).every(Number.isFinite), `${label} phase ${phase}`);
        }
        viewer.setRepetitions(1);
      }
    }
  }
  assert.equal(catalog.groups.length, 230);
  assert.equal(operationCount, 4425);
});

test("rotatory inversion is split into a proper rotation and inversion about its fixed point", () => {
  let count = 0;
  for (const group of catalog.groups) {
    for (const operation of group.operations.filter((op) => op.kind === "rotoinversion")) {
      count += 1;
      const point = product(group.A, seedPoints[0]);
      const middle = viewer.transformOnce(point, operation, .5);
      const final = viewer.transformOnce(point, operation, 1);
      close(final, middle.map((n, i) => 2 * operation.center[i] - n), `No.${group.id} rotated then inverted`);
      const distance = (p) => Math.hypot(...p.map((n, i) => n - operation.center[i]));
      assert.ok(Math.abs(distance(point) - distance(middle)) < 1e-8);
      close(viewer.transformOnce(point, operation, .75), operation.center, `No.${group.id} inversion midpoint`);
    }
  }
  assert.ok(count > 0, "the catalogue must exercise the rotatory-inversion branch");
  for (const id of [81, 174]) {
    const group = catalog.groups.find((g) => g.id === id);
    assert.ok(group.operations.some((op) => op.kind === "rotoinversion"), `No.${id}: rotatory inversion must be exercised`);
    assert.equal(group.centrosymmetric, false, `No.${id}: rotatory inversion does not imply pure inversion`);
    assert.deepEqual(group.inversionCenters, [], `No.${id}: no pure inversion centres may be marked red`);
  }
});

test("the client distinguishes nonpolar acentric groups from both polar and centrosymmetric groups", () => {
  const counts = new Map();
  for (const group of catalog.groups) {
    const category = classify.categoryOf(group);
    counts.set(category, (counts.get(category) || 0) + 1);
    assert.equal(category, group.category, `No.${group.id}: classification shown by the viewer`);
  }
  assert.equal(counts.get("polar"), 68);
  assert.equal(counts.get("centrosymmetric"), 92);
  assert.equal(counts.get("nonpolar-acentric"), 70);
  for (const id of [16, 81, 152, 174, 216]) {
    const group = catalog.groups.find((g) => g.id === id);
    assert.equal(classify.categoryLabel(group), "非中心对称、非极性");
    assert.equal(classify.polarityText(group), "无反演中心 · 对称性禁止非零宏观极化");
  }
  assert.equal(classify.categoryLabel(catalog.groups.find((g) => g.id === 1)), "极性");
  assert.equal(classify.categoryLabel(catalog.groups.find((g) => g.id === 2)), "中心对称");
});

test("the viewer retains descriptive text, red-center metadata, and responsive adjacent panels", () => {
  assert.match(template, /aria-label="对称操作文字说明"/);
  assert.match(template, /data-operation-description/);
  assert.match(template, /data-operation-steps/);
  assert.match(template, /'data-inversion-center':fractional\.join\(','\)/);
  assert.match(template, /\.inversion-center\s*\{\s*fill:#f52235/);
  assert.match(template, /@media\(max-width:820px\)/);
  assert.match(template, /<option value="nonpolar-acentric">非心非极性 · 70 类<\/option>/);
  assert.match(template, /该分解包含反演步骤，但反演单独并不是本群的对称操作/);
  assert.doesNotMatch(template, /P2\/n 非极性对照|非极性对照 · P2\/n/);
  // aria-label is updated with the operation; a static aria-labelledby must
  // not override the current group, formula or inversion-marker description.
  assert.doesNotMatch(template, /<svg[^>]*aria-labelledby=/);
});
