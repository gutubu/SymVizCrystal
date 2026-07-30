import assert from "node:assert/strict";
import test from "node:test";

const { parseCif } = await import("../app/crystal-data.ts");

const disorderCif = `data_disorder_test
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
_space_group_IT_number 1

loop_
_space_group_symop_operation_xyz
'x,y,z'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_disorder_assembly
_atom_site_disorder_group
C1A C 0.100 0.100 0.100 0.60 A 1
C1B C 0.120 0.100 0.100 0.40 A 2
N1A N 0.500 0.500 0.500 0.50 . .
N1B N 0.525 0.500 0.500 0.50 . .
O1  O 0.800 0.800 0.800 0.50 . .
`;

test("parses standard disorder fields and checks conformer occupancies", () => {
  const structure = parseCif(disorderCif);
  assert.equal(structure.disorder.explicit, true);
  assert.equal(structure.disorder.assemblies.length, 1);
  const assembly = structure.disorder.assemblies[0];
  assert.equal(assembly.id, "A");
  assert.deepEqual(assembly.groups.map((group) => group.id), ["1", "2"]);
  assert.equal(assembly.occupancyConsistent, true);
  assert.ok(Math.abs(assembly.occupancySum - 1) < 1e-8);
  assert.equal(structure.sites.find((site) => site.label === "C1A")?.disorderGroup, "1");
});

test("reports unmarked split-site candidates separately from explicit disorder", () => {
  const structure = parseCif(disorderCif);
  const candidate = structure.disorder.splitSiteCandidates.find(({ labels }) => labels.includes("N1A") && labels.includes("N1B"));
  assert.ok(candidate);
  assert.equal(candidate.confidence, "strong");
  assert.ok(Math.abs(candidate.occupancySum - 1) < 1e-8);
  assert.ok(structure.disorder.occupancyIssues.some((issue) => issue.kind === "partial-ungrouped" && issue.siteLabels.includes("O1")));
});

test("does not create covalent bonds between mutually exclusive conformers", () => {
  const structure = parseCif(disorderCif);
  const indexA = structure.atoms.findIndex((atom) => atom.source.label === "C1A");
  const indexB = structure.atoms.findIndex((atom) => atom.source.label === "C1B");
  assert.ok(indexA >= 0 && indexB >= 0);
  assert.equal(structure.bonds.some((bond) => (
    (bond.a === indexA && bond.b === indexB) || (bond.a === indexB && bond.b === indexA)
  )), false);
});
