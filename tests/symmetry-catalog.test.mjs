import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

const catalogue = JSON.parse(readFileSync(new URL("../public/symmetry-demo/catalog.json", import.meta.url), "utf8"));
const groups = catalogue.groups;
const byId = new Map(groups.map((group) => [group.id, group]));
const polarIds = [1, 3, 4, 5, 6, 7, 8, 9,
  ...Array.from({ length: 22 }, (_, i) => i + 25),
  ...Array.from({ length: 6 }, (_, i) => i + 75),
  ...Array.from({ length: 12 }, (_, i) => i + 99),
  ...Array.from({ length: 4 }, (_, i) => i + 143),
  ...Array.from({ length: 6 }, (_, i) => i + 156),
  ...Array.from({ length: 6 }, (_, i) => i + 168),
  ...Array.from({ length: 4 }, (_, i) => i + 183)];
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
const centroIds = [2, 10, 11, 12, 13, 14, 15, ...range(47, 74), ...range(83, 88),
  ...range(123, 142), 147, 148, ...range(162, 167), 175, 176, ...range(191, 194),
  ...range(200, 206), ...range(221, 230)];
const nonpolarAcentricIds = range(1, 230).filter((id) => !polarIds.includes(id) && !centroIds.includes(id));
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map((v) => v * s);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mv = (m, v) => m.map((row) => dot(row, v));
const transpose = (m) => m[0].map((_, i) => m.map((row) => row[i]));
const mm = (a, b) => a.map((row) => transpose(b).map((column) => dot(row, column)));
const mod24 = (n) => ((Math.round(n) % 24) + 24) % 24;
const key = (r, t) => `${r.flat().map(Math.round).join(",")};${t.map((v) => mod24(v * 24)).join(",")}`;
function near(actual, expected, context) {
  const a = actual.flat(Infinity), b = expected.flat(Infinity);
  assert.equal(a.length, b.length, context);
  for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]) && Math.abs(a[i] - b[i]) < 1e-8, `${context}: ${a[i]} != ${b[i]}`);
}
function rank(rows) {
  const matrix = rows.map((row) => [...row]);
  let pivot = 0;
  for (let column = 0; column < 3 && pivot < matrix.length; column++) {
    const found = matrix.findIndex((row, i) => i >= pivot && Math.abs(row[column]) > 1e-9);
    if (found < 0) continue;
    [matrix[pivot], matrix[found]] = [matrix[found], matrix[pivot]];
    const factor = matrix[pivot][column];
    matrix[pivot] = matrix[pivot].map((v) => v / factor);
    for (let i = 0; i < matrix.length; i++) if (i !== pivot) {
      const amount = matrix[i][column];
      matrix[i] = matrix[i].map((v, j) => v - amount * matrix[pivot][j]);
    }
    pivot++;
  }
  return pivot;
}
function animatedPoint(op, point, phase) {
  if (op.kind === "identity") return point;
  if (op.kind === "translation") return add(point, scale(op.v, phase));
  if (op.kind === "inversion") return add(op.center, scale(subtract(point, op.center), 1 - 2 * phase));
  if (op.kind === "rotation" || op.kind === "screw") {
    const shifted = subtract(point, op.point), angle = phase * op.angle, n = op.axis;
    const rotated = add(add(scale(shifted, Math.cos(angle)), scale(cross(n, shifted), Math.sin(angle))), scale(n, dot(n, shifted) * (1 - Math.cos(angle))));
    return add(add(op.point, rotated), scale(op.parallel, phase));
  }
  if (op.kind === "rotoinversion") {
    const shifted = subtract(point, op.center), angle = Math.min(1, phase * 2) * op.angle, n = op.axis;
    const rotated = add(add(scale(shifted, Math.cos(angle)), scale(cross(n, shifted), Math.sin(angle))), scale(n, dot(n, shifted) * (1 - Math.cos(angle))));
    return add(op.center, scale(rotated, 1 - 2 * Math.max(0, phase * 2 - 1)));
  }
  const mirror = op.kind === "mirror" ? phase : Math.min(1, 2 * phase);
  const slide = op.kind === "mirror" ? 0 : Math.max(0, 2 * phase - 1);
  return add(subtract(point, scale(op.normal, 2 * mirror * (dot(op.normal, point) - op.planeD))), scale(op.parallel, slide));
}

test("catalogue contains all 230 space-group types in three mutually exclusive symmetry classes", () => {
  assert.equal(catalogue.polarGroupCount, 68);
  assert.equal(catalogue.centrosymmetricGroupCount, 92);
  assert.equal(catalogue.nonpolarAcentricGroupCount, 70);
  assert.equal(groups.length, 230);
  assert.deepEqual(groups.map((g) => g.id), range(1, 230));
  assert.deepEqual(groups.filter((g) => g.polarGroup).map((g) => g.id), polarIds);
  assert.deepEqual(groups.filter((g) => g.centrosymmetric).map((g) => g.id), centroIds);
  assert.deepEqual(groups.filter((g) => g.nonpolarAcentric).map((g) => g.id), nonpolarAcentricIds);
  assert.equal(new Set(groups.map((g) => g.pointGroup)).size, 32);
  assert.equal(groups.reduce((count, group) => count + group.operations.length, 0), 4425);
  assert.equal(new Set(groups.map((g) => g.id)).size, 230);
  assert.equal("comparisonGroupCount" in catalogue, false);
  for (const g of groups) {
    assert.equal([g.polarGroup, g.centrosymmetric, g.nonpolarAcentric].filter(Boolean).length, 1);
    assert.equal(g.hasInversion, g.centrosymmetric);
    assert.equal(g.category, g.polarGroup ? "polar" : g.centrosymmetric ? "centrosymmetric" : "nonpolar-acentric");
  }
  assert.ok(groups.every((group) => !group.reused && group.operations.length === group.operationCount));
});

test("P1, P21 and Pn are available inside the app with their original coordinate setting", () => {
  assert.deepEqual(byId.get(1).operations.map((op) => op.xyz), ["x,y,z"]);
  assert.deepEqual(byId.get(4).operations.map((op) => op.xyz), ["x,y,z", "-x,y+1/2,-z"]);
  assert.equal(byId.get(7).name, "Pn");
  assert.deepEqual(byId.get(7).operations.map((op) => op.xyz), ["x,y,z", "x+1/2,-y,z+1/2"]);
  assert.ok([1, 4, 7].every((id) => byId.get(id).previouslyDemonstrated));
});

test("P2/n has pure twofold rotation, inversion and n glide, with zero polar dimension", () => {
  const group = byId.get(13);
  assert.equal(group.name, "P2/n");
  assert.equal(group.polarGroup, false);
  assert.equal(group.polarDimension, 0);
  assert.deepEqual(group.polarBasis, []);
  assert.deepEqual(group.operations.map((op) => op.xyz), ["x,y,z", "-x+1/2,y,-z+1/2", "-x,-y,-z", "x+1/2,-y,z+1/2"]);
  assert.deepEqual(group.operations.map((op) => op.kind), ["identity", "rotation", "inversion", "glide"]);
  near(group.operations[2].center, [0, 0, 0], "P2/n inversion centre");
});

test("R-centred settings retain the full H-cell operation sets and modern e-glide names", () => {
  for (const [id, count] of [[146, 9], [148, 18], [155, 18], [160, 18], [161, 18], [166, 36], [167, 36]]) {
    assert.ok(byId.get(id).setting.startsWith("H"));
    assert.equal(byId.get(id).operations.length, count);
    assert.equal(byId.get(id).cell[5], 120);
  }
  assert.equal(byId.get(39).name, "Aem2");
  assert.equal(byId.get(41).name, "Aea2");
  assert.equal(byId.get(64).name, "Cmce");
  assert.equal(byId.get(67).name, "Cmme");
  assert.equal(byId.get(68).name, "Ccce");
});

test("the public catalogue operations are closed modulo lattice translations", () => {
  for (const group of groups) {
    const keys = new Set(group.operations.map((op) => key(op.R, op.t)));
    assert.equal(keys.size, group.operationCount, `${group.name}: unique operation count`);
    for (const a of group.operations) for (const b of group.operations) {
      assert.ok(keys.has(key(mm(a.R, b.R), add(mv(a.R, b.t), a.t))), `${group.name}: affine closure`);
    }
  }
});

test("all public operation geometries match exact affine endpoints and their cell metrics", () => {
  const points = [[0.173, 0.287, 0.219], [-0.321, 0.119, 0.47], [0.72, -0.27, 1.3]];
  for (const group of groups) {
    const stacked = group.operations.flatMap((op) => op.R.map((row, i) => row.map((v, j) => v - identity[i][j])));
    const expectedDimension = !group.polarGroup ? 0 : group.id === 1 ? 3 : [6, 7, 8, 9].includes(group.id) ? 2 : 1;
    assert.equal(3 - rank(stacked), expectedDimension, `${group.name}: fixed polar subspace`);
    assert.equal(group.polarDimension, expectedDimension);
    near(mm(group.A, group.Ai), identity, `${group.name}: cell inverse`);
    for (const op of group.operations) {
      near(op.Q, mm(mm(group.A, op.R), group.Ai), `${group.name} ${op.xyz}: Cartesian matrix`);
      near(op.v, mv(group.A, op.t), `${group.name} ${op.xyz}: Cartesian translation`);
      near(mm(transpose(op.Q), op.Q), identity, `${group.name} ${op.xyz}: isometry`);
      const determinant = op.R[0][0] * (op.R[1][1] * op.R[2][2] - op.R[1][2] * op.R[2][1])
        - op.R[0][1] * (op.R[1][0] * op.R[2][2] - op.R[1][2] * op.R[2][0])
        + op.R[0][2] * (op.R[1][0] * op.R[2][1] - op.R[1][1] * op.R[2][0]);
      assert.equal(determinant, ["mirror", "glide", "inversion", "rotoinversion"].includes(op.kind) ? -1 : 1,
        `${group.name} ${op.xyz}: geometric handedness matches operation type`);
      for (const direction of group.polarBasis) near(mv(op.Q, direction), direction, `${group.name}: polar direction`);
      for (const fractional of points) {
        const point = mv(group.A, fractional);
        near(animatedPoint(op, point, 0), point, `${group.name} ${op.xyz}: start`);
        near(animatedPoint(op, point, 1), add(mv(op.Q, point), op.v), `${group.name} ${op.xyz}: endpoint`);
      }
    }
  }
});

test("all inversion centres in the closed conventional cell are real, complete and correctly boundary-weighted", () => {
  const minusIdentity = identity.map((row) => row.map((v) => -v));
  for (const group of groups) {
    assert.ok(Array.isArray(group.inversionCenters));
    const inversionOps = group.operations.filter((op) => key(op.R, [0, 0, 0]) === key(minusIdentity, [0, 0, 0]));
    const centers = group.inversionCenters;
    assert.equal(Boolean(centers.length), group.centrosymmetric, `${group.name}: inversion presence`);
    const centerKeys = new Set(centers.map((center) => center.map((v) => Math.round(v * 48)).join(",")));
    assert.equal(centerKeys.size, centers.length, `${group.name}: no duplicate display centres`);
    const operationKeys = new Set(group.operations.map((op) => key(op.R, op.t)));
    const expected = new Set();
    for (const op of inversionOps) {
      const choices = op.t.map((v) => {
        const value = mod24(v * 24);
        return [0, 1, 2].map((n) => value + n * 24).filter((n) => n <= 48);
      });
      for (const x of choices[0]) for (const y of choices[1]) for (const z of choices[2]) expected.add(`${x},${y},${z}`);
    }
    assert.deepEqual([...centerKeys].sort(), [...expected].sort(), `${group.name}: complete centrosymmetric lattice`);
    let weighted = 0;
    for (const center of centers) {
      assert.ok(center.every((v) => v >= 0 && v <= 1), `${group.name}: centre in closed cell`);
      assert.ok(operationKeys.has(key(minusIdentity, scale(center, 2))), `${group.name}: centre generates a legal (-I,2c)`);
      weighted += 2 ** -center.filter((v) => v === 0 || v === 1).length;
    }
    assert.equal(weighted, 8 * inversionOps.length, `${group.name}: correct sharing of boundary centres`);
    assert.equal(group.inversionCenterHalfOpenCount, weighted);
  }
  assert.equal(byId.get(2).inversionCenters.length, 27);
  assert.equal(byId.get(2).inversionCenterHalfOpenCount, 8);
  assert.ok(byId.get(48).inversionCenters.length > 0, "origin choice 2 is included");
  assert.equal(byId.get(225).inversionCenterHalfOpenCount, 32, "F centring expands the centre lattice");
});

test("every representative operation has a Chinese description and explicit steps", () => {
  const kinds = new Set();
  for (const group of groups) for (const op of group.operations) {
    kinds.add(op.kind);
    assert.ok(typeof op.description === "string" && op.description.length >= 12, `${group.name} ${op.xyz}: explanation`);
    assert.ok(Array.isArray(op.steps) && op.steps.length >= 2 && op.steps.every((s) => typeof s === "string" && s.length >= 4));
    assert.ok(op.steps.some((s) => s.includes(op.xyz)), `${group.name} ${op.xyz}: final coordinate step`);
  }
  assert.deepEqual([...kinds].sort(), ["identity", "translation", "rotation", "screw", "mirror", "glide", "inversion", "rotoinversion"].sort());
  assert.ok(byId.get(221).operations.some((op) => op.kind === "rotoinversion"), "cubic improper rotations are decomposed explicitly");
});

test("all 230 complete affine sets retain exact source fingerprints with disclosed PSI exceptions", () => {
  const reference = JSON.parse(readFileSync(new URL("../tools/symmetry-catalog-reference.json", import.meta.url), "utf8"));
  const certificate = new Map(reference.groups.map((g) => [g.id, g]));
  assert.equal(certificate.size, 230);
  assert.equal(reference.groups.filter((g) => g.pdfConfirmed).length, 228);
  assert.deepEqual(reference.groups.filter((g) => !g.pdfConfirmed).map((g) => g.id), [212, 228]);
  for (const group of groups) {
    const entries = group.operations.map((op) => [op.R.flat(), op.t.map((v) => mod24(v * 24))]);
    entries.sort((a, b) => {
      const x = a.flat(), y = b.flat();
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    });
    const sha = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    assert.equal(sha, certificate.get(group.id).affineSetSha256, `${group.name}: independent exact-set fingerprint`);
  }
  const sourcePath = new URL("../tools/symmetry-228-iucr-source.json", import.meta.url);
  const bytes = readFileSync(sourcePath), source = JSON.parse(bytes);
  assert.equal(source.coordinateMaps.length, 48);
  assert.equal(source.centringTranslationsUnits1over24.length, 4);
  assert.equal(certificate.get(228).pdfConfirmed, false);
  assert.equal(certificate.get(228).primaryFullSetConfirmed, true);
  assert.equal(certificate.get(228).alternatePrimarySource.sourceFileSha256, createHash("sha256").update(bytes).digest("hex"));
  const actual = new Set();
  for (const xyz of source.coordinateMaps) {
    const R = [], t = [];
    for (const expression of xyz.split(",")) {
      const match = expression.match(/^([+-]?)([xyz])(?:([+-])(\d+)\/(\d+))?$/);
      assert.ok(match, `IUCr coordinate fact parses exactly: ${expression}`);
      const row = [0, 0, 0];
      row["xyz".indexOf(match[2])] = match[1] === "-" ? -1 : 1;
      R.push(row);
      t.push(match[3] ? (match[3] === "-" ? -1 : 1) * Number(match[4]) / Number(match[5]) : 0);
    }
    const shift = source.originShiftUnits1over24.map((v) => v / 24);
    for (const centring of source.centringTranslationsUnits1over24) {
      actual.add(key(R, subtract(add(add(t, centring.map((v) => v / 24)), shift), mv(R, shift))));
    }
  }
  const expected = new Set(byId.get(228).operations.map((op) => key(op.R, op.t)));
  assert.equal(actual.size, 192);
  assert.deepEqual([...actual].sort(), [...expected].sort(), "IUCr origin-1 coordinates with F centring exactly transform to the displayed reference setting");
});

test("No.212 is independently reconstructed from source-only exact closure with the printed-map exception disclosed", () => {
  const path = new URL("../tools/symmetry-212-psi-source.json", import.meta.url);
  const bytes = readFileSync(path), source = JSON.parse(bytes);
  const parse = (xyz) => {
    const R = [], t = [];
    for (const expression of xyz.split(",")) {
      const m = expression.match(/^([+-]?)([xyz])(?:([+-])(\d+)(?:\/(\d+))?)?$/);
      assert.ok(m, `source coordinate parses independently: ${expression}`);
      const row = [0, 0, 0];
      row["xyz".indexOf(m[2])] = m[1] === "-" ? -1 : 1;
      R.push(row);
      t.push((m[3] === "-" ? -1 : 1) * Number(m[4] || 0) / Number(m[5] || 1));
    }
    return { R, t };
  };
  const compose = (a, b) => ({ R: mm(a.R, b.R), t: add(mv(a.R, b.t), a.t).map((v) => mod24(v * 24) / 24) });
  const printed = source.coordinateMaps.map(parse);
  const excluded = source.excludedSourceRow1Based - 1;
  assert.equal(printed.length, 24);
  assert.equal(excluded, 15);
  assert.equal(source.coordinateMaps[excluded], "+x+1/4,+z+3/4,-y+1/4");
  const trusted = printed.filter((_, index) => index !== excluded);
  const generated = new Map(trusted.map((op) => [key(op.R, op.t), op]));
  assert.equal(generated.size, 23);
  while (true) {
    const before = generated.size, members = [...generated.values()];
    for (const a of members) for (const b of members) {
      const product = compose(a, b);
      generated.set(key(product.R, product.t), product);
    }
    assert.ok(generated.size <= 192, "source closure remains bounded");
    if (generated.size === before) break;
  }
  assert.equal(generated.size, 24);
  const expected = new Set(byId.get(212).operations.map((op) => key(op.R, op.t)));
  assert.deepEqual([...generated.keys()].sort(), [...expected].sort(), "23 source rows independently generate the complete displayed group");
  assert.equal(generated.has(key(printed[excluded].R, printed[excluded].t)), false, "the printed source exception is not silently accepted");
  const witness = compose(printed[1], printed[12]);
  assert.equal(key(witness.R, witness.t), key([[1, 0, 0], [0, 0, 1], [0, -1, 0]], [1 / 4, 3 / 4, 3 / 4]),
    "PSI row 2 after row 13 directly derives the missing x+1/4,z+3/4,-y+3/4 map");
  const rawKeys = new Set(printed.map((op) => key(op.R, op.t)));
  assert.ok(printed.some((a) => printed.some((b) => { const c = compose(a, b); return !rawKeys.has(key(c.R, c.t)); })), "the 24 raw printed maps fail affine closure");
  const reference = JSON.parse(readFileSync(new URL("../tools/symmetry-catalog-reference.json", import.meta.url), "utf8"));
  const certificate = reference.groups.find((g) => g.id === 212);
  assert.equal(certificate.pdfConfirmed, false);
  assert.equal(certificate.primaryFullSetConfirmed, false);
  assert.equal(certificate.sourceClosureConfirmed, true);
  assert.equal(certificate.alternateSourceClosure.sourceFileSha256, createHash("sha256").update(bytes).digest("hex"));
});

test("all operation objects from the previous 160 types are preserved exactly", () => {
  const reference = JSON.parse(readFileSync(new URL("../tools/symmetry-160-operation-reference.json", import.meta.url), "utf8"));
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  assert.equal(reference.groups.length, 160);
  assert.equal(reference.operationCount, 3105);
  for (const previous of reference.groups) {
    const operations = byId.get(previous.id).operations;
    assert.equal(operations.length, previous.operationCount);
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical(operations))).digest("hex");
    assert.equal(fingerprint, previous.operationObjectsSha256, `No.${previous.id}: geometry, matrices, text and all other operation fields preserved`);
  }
});

test("nonpolar acentric types including -4 and -6 forbid a polar vector without containing inversion", () => {
  assert.equal(nonpolarAcentricIds.length, 70);
  assert.equal(groups.filter((g) => g.nonpolarAcentric).reduce((n, g) => n + g.operationCount, 0), 1320);
  for (const id of nonpolarAcentricIds) {
    const g = byId.get(id);
    assert.equal(g.polarDimension, 0, `${g.name}: no invariant polar vector`);
    assert.equal(g.hasInversion, false, `${g.name}: no pure inversion`);
    assert.deepEqual(g.inversionCenters, [], `${g.name}: no red inversion-centre positions`);
    assert.ok(g.operations.every((op) => op.kind !== "inversion"));
  }
  for (const [id, pg] of [[81, "-4"], [82, "-4"], [174, "-6"]]) {
    const g = byId.get(id);
    assert.equal(g.pointGroup, pg);
    assert.ok(g.operations.some((op) => op.kind === "rotoinversion"), `${g.name}: rotatory inversion exists`);
    for (const op of g.operations.filter((op) => op.kind === "rotoinversion")) {
      near(add(mv(op.Q, op.center), op.v), op.center, `${g.name}: rotatory-inversion fixed point`);
    }
  }
});
