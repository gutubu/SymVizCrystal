import assert from "node:assert/strict";
import test from "node:test";

const { parseStructureFile } = await import("../app/crystal-data.ts");

test("loads XYZ coordinates and infers molecular bonds", () => {
  const structure = parseStructureFile(`3
water
O 0.000 0.000 0.000
H 0.958 0.000 0.000
H -0.240 0.927 0.000
`, "water.xyz");
  assert.equal(structure.name, "water");
  assert.equal(structure.atoms.length, 3);
  assert.equal(structure.bonds.length, 2);
  assert.equal(structure.formula, "H₂O");
  assert.equal(structure.spaceGroup, "P 1");
  assert.match(structure.warnings[0], /自动生成的 P1/);
});

test("loads SDF V2000 atoms and explicit bonds", () => {
  const structure = parseStructureFile(`carbon monoxide
SymViz

  2  1  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.1300    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  3  0  0  0  0
M  END
$$$$
`, "co.sdf");
  assert.equal(structure.atoms.length, 2);
  assert.equal(structure.bonds.length, 1);
  assert.deepEqual(structure.bonds[0].imageShift, [0, 0, 0]);
  assert.equal(structure.formula, "CO");
});

test("loads SDF V3000 atoms and explicit bonds", () => {
  const structure = parseStructureFile(`oxygen
SymViz

  0  0  0     0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 2 1 0 0 0
M  V30 BEGIN ATOM
M  V30 1 O 0.000 0.000 0.000 0
M  V30 2 O 1.210 0.000 0.000 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 2 1 2
M  V30 END BOND
M  V30 END CTAB
M  END
$$$$
`, "oxygen.sdf");
  assert.equal(structure.atoms.length, 2);
  assert.equal(structure.bonds.length, 1);
  assert.equal(structure.formula, "O₂");
});

test("loads MOL2 atom and bond sections", () => {
  const structure = parseStructureFile(`@<TRIPOS>MOLECULE
formaldehyde
2 1 0 0 0
SMALL
NO_CHARGES

@<TRIPOS>ATOM
1 C1 0.000 0.000 0.000 C.2 1 MOL 0.0
2 O1 1.210 0.000 0.000 O.2 1 MOL 0.0
@<TRIPOS>BOND
1 1 2 2
`, "formaldehyde.mol2");
  assert.equal(structure.name, "formaldehyde");
  assert.equal(structure.atoms.length, 2);
  assert.equal(structure.bonds.length, 1);
  assert.deepEqual(structure.atoms.map((atom) => atom.element), ["C", "O"]);
});

test("loads PDB ATOM and CONECT records", () => {
  const structure = parseStructureFile(`HEADER    TEST STRUCTURE
HETATM    1  C1  LIG A   1       0.000   0.000   0.000  1.00  0.00           C
HETATM    2  O1  LIG A   1       1.210   0.000   0.000  1.00  0.00           O
CONECT    1    2
END
`, "ligand.pdb");
  assert.equal(structure.atoms.length, 2);
  assert.equal(structure.bonds.length, 1);
  assert.deepEqual(structure.atoms.map((atom) => atom.element), ["C", "O"]);
});
