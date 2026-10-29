import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CIF, parseCif } from "../app/crystal-data.ts";
import {
  buildQuantumEspressoCutoffSeries,
  buildQuantumEspressoInput,
  convergenceDeltaMevPerAtom,
  parseQuantumEspressoOutput,
  quantumEspressoBasisCatalog,
  quantumEspressoCutoffsForPreset,
  quantumEspressoMethodCatalog,
  recommendQuantumEspressoSettings,
  recommendedConvergenceIndex,
  suggestQuantumEspressoKPointMeshes,
  suggestQuantumEspressoPseudopotentials,
} from "../app/quantum-espresso-tools.ts";
import { createTextZip } from "../app/zip-tools.ts";

test("Quantum ESPRESSO input uses the full periodic cell and explicit lattice vectors", () => {
  const structure = parseCif(DEFAULT_CIF, "alpha-quartz.cif");
  const suggestions = suggestQuantumEspressoPseudopotentials(
    ["O", "Si"],
    ["O.pbe-n-kjpaw_psl.1.0.0.UPF", "Si.pbe-n-kjpaw_psl.1.0.0.UPF"],
  );
  const result = buildQuantumEspressoInput(structure, {
    title: "Alpha quartz",
    prefix: "alpha-quartz",
    calculation: "relax",
    inputDft: "PBE",
    dispersion: "none",
    occupations: "fixed",
    smearing: "gaussian",
    degaussRy: 0.01,
    ecutwfcRy: 60,
    ecutrhoRy: 480,
    kPoints: [4, 4, 4],
    kPointShift: [0, 0, 0],
    convThr: 1e-8,
    forceConvThr: 1e-4,
    pressureConvThr: 0.5,
    pseudopotentials: suggestions,
  });
  assert.equal(result.diagnostics.blockingIssues.length, 0);
  assert.equal(result.diagnostics.atomCount, 12);
  assert.match(result.input, /calculation = 'relax'/);
  assert.match(result.input, /nat = 12/);
  assert.match(result.input, /ATOMIC_POSITIONS crystal/);
  assert.match(result.input, /CELL_PARAMETERS angstrom/);
  assert.match(result.input, /4 4 4 0 0 0/);
  assert.deepEqual(result.requiredPseudopotentials.sort(), ["O.pbe-n-kjpaw_psl.1.0.0.UPF", "Si.pbe-n-kjpaw_psl.1.0.0.UPF"]);
});

test("Quantum ESPRESSO output parser reads completion and the final energy", () => {
  const summary = parseQuantumEspressoOutput(`
     convergence has been achieved in  11 iterations
!    total energy              =    -114.12345678 Ry
     the Fermi energy is    1.2345 ev
     Forces acting on atoms (cartesian axes, Ry/au):
     atom    1 type  1   force =     0.00100000   -0.00200000    0.00200000
     atom    2 type  1   force =     0.00010000    0.00020000    0.00030000
     Total force =     0.003500
          total   stress  (Ry/bohr**3)                   (kbar)     P=       1.25
     JOB DONE.
  `);
  assert.equal(summary.status, "completed");
  assert.equal(summary.jobDone, true);
  assert.equal(summary.convergenceReached, true);
  assert.equal(summary.totalEnergyRy, -114.12345678);
  assert.equal(summary.scfIterations, 11);
  assert.equal(summary.pressureKbar, 1.25);
  assert.equal(summary.totalForceRyBohr, 0.0035);
  assert.ok(Math.abs(summary.maximumForceRyBohr - 0.003) < 1e-12);
});

test("Quantum ESPRESSO convergence helpers generate monotonic bounded studies", () => {
  const structure = parseCif(DEFAULT_CIF);
  const meshes = suggestQuantumEspressoKPointMeshes(structure.cell, 6);
  assert.ok(meshes.length >= 2);
  assert.deepEqual(meshes[0].kPoints, [1, 1, 1]);
  assert.ok(meshes.every((candidate, index) => index === 0 || candidate.pointCount >= meshes[index - 1].pointCount));
  assert.equal(new Set(meshes.map((candidate) => candidate.kPoints.join("x"))).size, meshes.length);

  const cutoffs = buildQuantumEspressoCutoffSeries(30, 65, 10, 8);
  assert.deepEqual(cutoffs, [
    { ecutwfcRy: 30, ecutrhoRy: 240 },
    { ecutwfcRy: 40, ecutrhoRy: 320 },
    { ecutwfcRy: 50, ecutrhoRy: 400 },
    { ecutwfcRy: 60, ecutrhoRy: 480 },
    { ecutwfcRy: 65, ecutrhoRy: 520 },
  ]);
  assert.ok(Math.abs(convergenceDeltaMevPerAtom(-100, -100.004, 4) - 1) < 1e-9);
  assert.equal(recommendedConvergenceIndex([3, 0.8, 0.2, 0], 1), 1);
  assert.equal(recommendedConvergenceIndex([3, 1.2, 0], 1), -1);
});

test("Quantum ESPRESSO input supports molecular dynamics and UPF-defined XC", () => {
  const structure = parseCif(DEFAULT_CIF);
  const result = buildQuantumEspressoInput(structure, {
    title: "Quartz MD",
    prefix: "quartz-md",
    calculation: "vc-md",
    inputDft: "auto",
    dispersion: "none",
    occupations: "fixed",
    smearing: "gaussian",
    degaussRy: 0.01,
    ecutwfcRy: 60,
    ecutrhoRy: 480,
    kPoints: [2, 2, 2],
    kPointShift: [0, 0, 0],
    convThr: 1e-8,
    forceConvThr: 1e-4,
    pressureConvThr: 0.5,
    mdSteps: 250,
    mdTimeStepAu: 15,
    temperatureK: 350,
    pseudopotentials: { Si: "Si.UPF", O: "O.UPF" },
  });
  assert.match(result.input, /calculation = 'vc-md'/);
  assert.match(result.input, /nstep = 250/);
  assert.match(result.input, /tempw = 350\.00/);
  assert.match(result.input, /cell_dynamics = 'pr'/);
  assert.doesNotMatch(result.input, /input_dft/);
});

test("Quantum ESPRESSO recommendations classify CIFs and expose explained method and basis catalogs", () => {
  const quartz = parseCif(DEFAULT_CIF);
  const quartzRecommendation = recommendQuantumEspressoSettings(quartz);
  assert.equal(quartzRecommendation.systemClass, "inorganic-solid");
  assert.equal(quartzRecommendation.inputDft, "PBE");
  assert.equal(quartzRecommendation.dispersion, "none");
  assert.equal(quartzRecommendation.occupations, "fixed");
  assert.deepEqual(
    quantumEspressoCutoffsForPreset(["Si", "O"], "sssp-efficiency"),
    { ecutwfcRy: 45, ecutrhoRy: 540 },
  );

  const organic = parseCif(`data_organic
_cell_length_a 12
_cell_length_b 10
_cell_length_c 8
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
C1 C 0.1 0.2 0.3
O1 O 0.2 0.2 0.3
H1 H 0.05 0.2 0.3
`);
  const organicRecommendation = recommendQuantumEspressoSettings(organic);
  assert.equal(organicRecommendation.systemClass, "molecular-crystal");
  assert.equal(organicRecommendation.dispersion, "d3-bj");
  assert.equal(organicRecommendation.occupations, "fixed");
  const organicInput = buildQuantumEspressoInput(organic, {
    title: "Organic crystal",
    prefix: "organic",
    calculation: "relax",
    inputDft: "PBE",
    dispersion: "d3-bj",
    occupations: "fixed",
    smearing: "mv",
    degaussRy: 0.01,
    ecutwfcRy: organicRecommendation.ecutwfcRy,
    ecutrhoRy: organicRecommendation.ecutrhoRy,
    kPoints: organicRecommendation.kPoints,
    kPointShift: [0, 0, 0],
    convThr: 1e-8,
    forceConvThr: 1e-4,
    pressureConvThr: 0.5,
    pseudopotentials: { C: "C.UPF", O: "O.UPF", H: "H.UPF" },
  });
  assert.match(organicInput.input, /dftd3_version = 4/);
  assert.ok(quantumEspressoMethodCatalog.every((method) => method.summaryZh && method.summaryEn && method.cautionZh && method.cautionEn));
  assert.deepEqual(new Set(quantumEspressoBasisCatalog.map((basis) => basis.id)), new Set(["screening", "sssp-efficiency", "conservative", "custom"]));
});

test("dependency-free ZIP builder packages convergence input text", () => {
  const archive = createTextZip([
    { name: "README.txt", contents: "convergence inputs" },
    { name: "quartz-k-2x2x2.in", contents: "&CONTROL\n/\n" },
  ]);
  assert.deepEqual([...archive.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const raw = new TextDecoder().decode(archive);
  assert.match(raw, /README\.txt/);
  assert.match(raw, /quartz-k-2x2x2\.in/);
  assert.deepEqual([...archive.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
});
