import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CIF, parseCif } from "../app/crystal-data.ts";
import {
  buildQuantumEspressoInput,
  parseQuantumEspressoOutput,
  suggestQuantumEspressoPseudopotentials,
} from "../app/quantum-espresso-tools.ts";

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
          total   stress  (Ry/bohr**3)                   (kbar)     P=       1.25
     JOB DONE.
  `);
  assert.equal(summary.status, "completed");
  assert.equal(summary.jobDone, true);
  assert.equal(summary.convergenceReached, true);
  assert.equal(summary.totalEnergyRy, -114.12345678);
  assert.equal(summary.scfIterations, 11);
  assert.equal(summary.pressureKbar, 1.25);
});
