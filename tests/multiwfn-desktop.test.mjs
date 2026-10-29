import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MultiwfnDesktopService,
  detectMultiwfnRoot,
  inspectFrontierOrbitals,
  multiwfnBinaries,
  multiwfnTaskTemplates,
  validateMultiwfnInput,
} from "../desktop/multiwfn-service.mjs";

test("Multiwfn detection finds a versioned folder beside the app", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-multiwfn-detect-"));
  try {
    const packageRoot = join(root, "Multiwfn_2026.7.15_bin_Win64");
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "Multiwfn.exe"), "placeholder");
    await writeFile(join(packageRoot, "settings.ini"), "nthreads= 4\n");
    assert.equal(detectMultiwfnRoot("", [root]), packageRoot);
    assert.equal(multiwfnBinaries(packageRoot).multiwfn, join(packageRoot, "Multiwfn.exe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Multiwfn input validation allows wavefunction files and rejects unknown formats", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-multiwfn-input-"));
  try {
    const fchk = join(root, "water.fchk");
    const unknown = join(root, "water.exe");
    await writeFile(fchk, "formatted checkpoint");
    await writeFile(unknown, "not an input");
    assert.equal(validateMultiwfnInput(fchk), fchk);
    assert.throws(() => validateMultiwfnInput(unknown), /Unsupported Multiwfn input format/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("curated Multiwfn templates are non-interactive and the desktop status exposes them", async () => {
  for (const template of [multiwfnTaskTemplates.summary, multiwfnTaskTemplates.aim, multiwfnTaskTemplates.espExtrema, multiwfnTaskTemplates.resp, multiwfnTaskTemplates.frontierOrbitals, multiwfnTaskTemplates.densityCube, multiwfnTaskTemplates.espCube]) {
    assert.match(template.script, /(?:^|\n)q\n$/);
  }
  assert.match(multiwfnTaskTemplates.densityCube.script, /5\n1\n2\n2\n0\nq/);
  assert.match(multiwfnTaskTemplates.espCube.script, /5\n12\n2\n2\n0\nq/);
  const root = await mkdtemp(join(tmpdir(), "symviz-multiwfn-service-"));
  try {
    const packageRoot = join(root, "Multiwfn_2026.7.15_bin_Win64");
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "Multiwfn.exe"), "placeholder");
    await writeFile(join(packageRoot, "settings.ini"), "nthreads= 4\n");
    const service = new MultiwfnDesktopService({ workRoot: join(root, "jobs"), searchRoots: [root] });
    const status = await service.initialize();
    assert.equal(status.available, true);
    assert.equal(status.multiwfnVersion, "2026.7.15");
    assert.deepEqual(status.templates.map((template) => template.id), ["summary", "aim", "esp-extrema", "resp", "frontier-orbitals", "homo-cube", "lumo-cube", "density-cube", "esp-cube", "custom"]);
    assert.equal("script" in status.templates[0], false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontier orbital inspection reads restricted FCHK energies and gap", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-frontier-fchk-"));
  try {
    const input = join(root, "water.fchk");
    await writeFile(input, [
      "Water formatted checkpoint",
      "Number of alpha electrons                  I              5",
      "Number of beta electrons                   I              5",
      "Number of independent functions            I             10",
      "Alpha Orbital Energies                     R   N=          10",
      " -2.00000000E+01 -1.20000000E+00 -6.00000000E-01 -4.00000000E-01 -3.00000000E-01",
      "  5.00000000E-02  1.00000000E-01  2.00000000E-01  3.00000000E-01  4.00000000E-01",
    ].join("\n"));
    const frontier = await inspectFrontierOrbitals(input);
    assert.equal(frontier.homo.index, 5);
    assert.equal(frontier.lumo.index, 6);
    assert.equal(frontier.homo.energyHartree, -0.3);
    assert.equal(frontier.lumo.energyHartree, 0.05);
    assert.ok(Math.abs(frontier.gapEv - 0.35 * 27.211386245988) < 1e-10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("occupied-only WFN reports HOMO and refuses to invent a LUMO", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-frontier-wfn-"));
  try {
    const input = join(root, "occupied-only.wfn");
    await writeFile(input, [
      "MO    1     MO 0.0        OCC NO =    2.0000000  ORB. ENERGY =  -1.000000",
      "MO    2     MO 0.0        OCC NO =    2.0000000  ORB. ENERGY =  -0.250000",
    ].join("\n"));
    const frontier = await inspectFrontierOrbitals(input);
    assert.equal(frontier.homo.index, 2);
    assert.equal(frontier.homo.energyHartree, -0.25);
    assert.equal(frontier.lumo, null);
    assert.equal(frontier.gapEv, null);
    assert.match(frontier.note, /occupied orbitals only/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HOMO Cube jobs use the detected orbital index and LUMO jobs block occupied-only WFN", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-frontier-job-"));
  try {
    const packageRoot = join(root, "Multiwfn_2026.7.15_bin_Win64");
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "Multiwfn.exe"), "placeholder");
    const input = join(root, "occupied-only.wfn");
    await writeFile(input, [
      "MO    1     MO 0.0        OCC NO =    2.0000000  ORB. ENERGY =  -1.000000",
      "MO    2     MO 0.0        OCC NO =    2.0000000  ORB. ENERGY =  -0.250000",
    ].join("\n"));
    const service = new MultiwfnDesktopService({ workRoot: join(root, "jobs"), searchRoots: [root] });
    service.starting = true;
    const job = await service.submit({ name: "frontier", inputPath: input, taskId: "homo-cube" });
    assert.equal(job.frontier.homo.index, 2);
    assert.equal(await readFile(job.files.script, "utf8"), "5\n4\n2\n2\n2\n0\nq\n");
    await assert.rejects(
      service.submit({ name: "frontier", inputPath: input, taskId: "lumo-cube" }),
      /no LUMO is present/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
