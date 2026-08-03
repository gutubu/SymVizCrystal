import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CIF, parseCif } from "../app/crystal-data.ts";
import {
  calculateDensitySlice,
  calculatePowderPattern,
  calculateReflections,
  cellVolume,
  ewaldElectrostatics,
  measureGeometry,
  reducedCellCandidate,
} from "../app/crystal-utilities.ts";

test("periodic geometry returns finite distances and angles", () => {
  const structure = parseCif(DEFAULT_CIF);
  const result = measureGeometry(structure, [0, 1, 2, 3]);
  assert.ok(Number.isFinite(result.distance));
  assert.ok(result.distance > 0);
  assert.ok(Number.isFinite(result.angle));
  assert.ok(result.angle >= 0 && result.angle <= 180);
  assert.ok(Number.isFinite(result.dihedral));
});

test("calculated reflections obey the requested angular range", () => {
  const structure = parseCif(DEFAULT_CIF);
  const reflections = calculateReflections(structure, 1.5406, 10, 60);
  assert.ok(reflections.length > 0);
  assert.ok(reflections.every((reflection) => reflection.twoTheta >= 10 && reflection.twoTheta <= 60));
  const powder = calculatePowderPattern(reflections, 10, 60, 0.1, 0.18);
  assert.ok(powder.length > 100);
  assert.ok(Math.abs(Math.max(...powder.map((point) => point.intensity)) - 100) < 1e-8);
});

test("reduced-cell candidate preserves cell volume", () => {
  const structure = parseCif(DEFAULT_CIF);
  const candidate = reducedCellCandidate(structure.cell);
  assert.ok(Math.abs(cellVolume(candidate.cell) - cellVolume(structure.cell)) < 1e-6);
  const determinant = (
    candidate.transform[0][0] * (candidate.transform[1][1] * candidate.transform[2][2] - candidate.transform[1][2] * candidate.transform[2][1])
    - candidate.transform[0][1] * (candidate.transform[1][0] * candidate.transform[2][2] - candidate.transform[1][2] * candidate.transform[2][0])
    + candidate.transform[0][2] * (candidate.transform[1][0] * candidate.transform[2][1] - candidate.transform[1][1] * candidate.transform[2][0])
  );
  assert.equal(Math.abs(determinant), 1);
});

test("density slices are normalized and include a line profile", () => {
  const structure = parseCif(DEFAULT_CIF);
  for (const mode of ["electron", "nuclear", "patterson"]) {
    const density = calculateDensitySlice(structure, mode, 0.5, 24);
    assert.equal(density.values.length, 24 * 24);
    assert.equal(density.lineProfile.length, 24);
    assert.ok(density.values.every((value) => value >= 0 && value <= 1));
  }
});

test("Ewald electrostatics requires neutrality and returns a finite ionic energy", () => {
  const salt = parseCif(`data_salt
_cell_length_a 5.64
_cell_length_b 5.64
_cell_length_c 5.64
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
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
Na1 Na 0 0 0 1
Cl1 Cl 0.5 0.5 0.5 1
`);
  const charged = ewaldElectrostatics(salt, { Na: 1, Cl: 0 });
  assert.equal(charged.neutral, false);
  assert.equal(charged.energyEv, null);
  const neutral = ewaldElectrostatics(salt, { Na: 1, Cl: -1 });
  assert.equal(neutral.neutral, true);
  assert.ok(Number.isFinite(neutral.energyEv));
  assert.ok(neutral.energyEv < 0);
  assert.equal(neutral.potentialsEv.length, 2);
});
