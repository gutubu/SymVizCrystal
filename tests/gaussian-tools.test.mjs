import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CIF, parseCif } from "../app/crystal-data.ts";
import {
  buildCubeIsosurface,
  buildGaussianInput,
  buildGaussianInputFromModel,
  defaultCubeIsovalue,
  gaussianAtomIndices,
  parseGaussianCube,
  parseGaussianOutput,
  prepareGaussianModel,
} from "../app/gaussian-tools.ts";

const BOUNDARY_MOLECULE_CIF = `
data_boundary_molecule
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.95 0.5 0.5
H1 H 0.05 0.5 0.5
`;

test("builds a Gaussian input for the selected molecular component", () => {
  const structure = parseCif(DEFAULT_CIF);
  const indices = gaussianAtomIndices(structure, 0, "selected-molecule");
  const input = buildGaussianInput(structure, indices, {
    title: "Alpha quartz fragment",
    charge: 0,
    multiplicity: 1,
    method: "B3LYP",
    basis: "6-31G(d,p)",
    calculation: "opt-freq",
    memoryGB: 8,
    processors: 4,
    solvent: "Water",
    routeExtras: "Pop=Full",
    checkpointName: "quartz-test",
  });
  assert.match(input, /%chk=quartz-test\.chk/);
  assert.match(input, /%mem=8GB/);
  assert.match(input, /%nprocshared=4/);
  assert.match(input, /#p B3LYP\/6-31G\(d,p\) Opt Freq/);
  assert.match(input, /SCRF=\(SMD,Solvent=Water\)/);
  assert.match(input, /\n0 1\n/);
  assert.match(input, /\nSi\s+/);
});

test("reconnects a molecule across a periodic boundary before Gaussian export", () => {
  const structure = parseCif(BOUNDARY_MOLECULE_CIF);
  const indices = gaussianAtomIndices(structure, 0, "selected-molecule");
  const model = prepareGaussianModel(structure, indices, "selected-molecule");
  assert.equal(model.atoms.length, 2);
  assert.equal(model.diagnostics.moleculeCount, 1);
  assert.equal(model.diagnostics.fragmentCount, 1);
  assert.equal(model.diagnostics.isolatedAtomIndices.length, 0);
  assert.equal(model.diagnostics.graphConsistent, true);
  assert.equal(model.diagnostics.blockingIssues.length, 0);
  const distance = Math.hypot(...model.atoms[0].cart.map((value, axis) => value - model.atoms[1].cart[axis]));
  assert.ok(Math.abs(distance - 1) < 1e-8);
});

test("blocks a mismatched Cartesian graph and isolated H/F atoms", () => {
  const structure = parseCif(BOUNDARY_MOLECULE_CIF);
  const malformed = {
    ...structure,
    bonds: structure.bonds.map((bond) => ({ ...bond, imageShift: [0, 0, 0] })),
  };
  const model = prepareGaussianModel(malformed, [0, 1], "generated-atoms");
  assert.equal(model.diagnostics.graphConsistent, false);
  assert.equal(model.diagnostics.fragmentCount, 2);
  assert.deepEqual(model.diagnostics.isolatedLabels, ["C1", "H1"]);
  assert.ok(model.diagnostics.blockingIssues.some((issue) => /Isolated H\/F/.test(issue)));
});

test("creates a staged small-basis optimization followed by a final calculation", () => {
  const structure = parseCif(BOUNDARY_MOLECULE_CIF);
  const model = prepareGaussianModel(structure, [0, 1], "selected-molecule");
  const input = buildGaussianInputFromModel(structure, model, {
    title: "Boundary molecule",
    charge: 0,
    multiplicity: 1,
    method: "PBE0",
    basis: "Def2TZVP",
    calculation: "opt-freq",
    memoryGB: 4,
    processors: 2,
    solvent: "",
    routeExtras: "EmpiricalDispersion=GD3BJ",
    checkpointName: "boundary",
    workflow: "preopt-final",
    preoptimizationMethod: "B3LYP",
    preoptimizationBasis: "6-31G(d)",
  });
  assert.match(input, /%chk=boundary-preopt\.chk/);
  assert.match(input, /#p B3LYP\/6-31G\(d\) Opt/);
  assert.match(input, /--Link1--/);
  assert.match(input, /%oldchk=boundary-preopt\.chk/);
  assert.match(input, /#p PBE0\/Def2TZVP Opt Freq Geom=AllCheck Guess=Read/);
});

test("parses common Gaussian energies, orbitals, frequencies, and termination status", () => {
  const summary = parseGaussianOutput(`
 SCF Done:  E(RB3LYP) =  -154.123456789     A.U. after 10 cycles
 Alpha  occ. eigenvalues -- -0.80000 -0.32000 -0.25000
 Alpha virt. eigenvalues --  0.02000  0.09000
 Frequencies --  -32.50  120.25  1610.10
 Zero-point correction=                           0.123456 (Hartree/Particle)
 Sum of electronic and thermal Free Energies=   -153.987654
 Dipole moment (field-independent basis, Debye):
     X= 0.1000    Y= 0.2000    Z= 0.3000  Tot= 0.3742
 Elapsed time:       0 days  0 hours  2 minutes  3.4 seconds.
 Normal termination of Gaussian 16
`);
  assert.equal(summary.status, "completed");
  assert.equal(summary.methodLabel, "RB3LYP");
  assert.equal(summary.scfEnergyHartree, -154.123456789);
  assert.equal(summary.homoHartree, -0.25);
  assert.equal(summary.lumoHartree, 0.02);
  assert.ok(summary.gapEv > 7.3 && summary.gapEv < 7.4);
  assert.equal(summary.imaginaryFrequencyCount, 1);
  assert.equal(summary.dipoleDebye, 0.3742);
  assert.equal(summary.frequenciesCm1.length, 3);
});

test("loads a Gaussian Cube grid and creates an isosurface mesh", () => {
  const cube = parseGaussianCube(`Simple cube
Generated for tests
 1 0.000000 0.000000 0.000000
 2 1.000000 0.000000 0.000000
 2 0.000000 1.000000 0.000000
 2 0.000000 0.000000 1.000000
 8 0.000000 0.000000 0.000000 0.000000
 0.000000 0.000000 0.000000 0.000000
 0.000000 1.000000 1.000000 1.000000
`);
  assert.deepEqual(cube.dimensions, [2, 2, 2]);
  assert.equal(cube.atoms.length, 1);
  assert.equal(cube.values.length, 8);
  assert.equal(cube.sourceUnit, "bohr");
  const isovalue = defaultCubeIsovalue(cube);
  assert.ok(isovalue > 0 && isovalue < 1);
  const mesh = buildCubeIsosurface(cube, 0.5, true, false);
  assert.ok(mesh.triangles.length > 0);
  assert.ok(mesh.triangles.every((triangle) => triangle.sign === 1));
});
