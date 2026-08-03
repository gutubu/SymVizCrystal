import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  QuantumEspressoDesktopService,
  discoverWslQuantumEspresso,
  detectQuantumEspressoRoot,
  listPseudopotentials,
  quantumEspressoBinaries,
} from "../desktop/quantum-espresso-service.mjs";

test("desktop Quantum ESPRESSO service discovers pw.x and SSSP through WSL", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-qe-wsl-"));
  const calls = [];
  const runner = async (_executable, args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command.includes("--list --quiet")) return { exitCode: 0, stdout: "Ubuntu\n", stderr: "", error: null };
    if (command.includes("command -v pw.x")) return {
      exitCode: 0,
      stdout: "pw=/usr/bin/pw.x\nph=/usr/bin/ph.x\npp=/usr/bin/pp.x\nbands=/usr/bin/bands.x\ndos=/usr/bin/dos.x\nprojwfc=/usr/bin/projwfc.x\n",
      stderr: "",
      error: null,
    };
    if (command.includes("/usr/bin/pw.x -h")) return { exitCode: 0, stdout: "Program PWSCF v.6.7MaX starts", stderr: "", error: null };
    if (command.includes("quantum-espresso-data-sssp")) return {
      exitCode: 0,
      stdout: "/usr/share/espresso/pseudo/Si.pbe.UPF\n/usr/share/espresso/pseudo/O.pbe.UPF\n",
      stderr: "",
      error: null,
    };
    if (command.includes("/usr/bin/wslpath")) return { exitCode: 0, stdout: "/mnt/c/SymViz/pseudo\n", stderr: "", error: null };
    if (command.includes("/bin/cp")) return { exitCode: 0, stdout: "", stderr: "", error: null };
    return { exitCode: 1, stdout: "", stderr: "unexpected test command", error: null };
  };
  try {
    const discovered = await discoverWslQuantumEspresso("Ubuntu", runner);
    assert.equal(discovered.distro, "Ubuntu");
    assert.equal(discovered.version, "6.7MaX");
    assert.deepEqual(discovered.pseudopotentials.map((item) => item.name), ["Si.pbe.UPF", "O.pbe.UPF"]);
    const service = new QuantumEspressoDesktopService({ workRoot: join(root, "jobs"), commandRunner: runner });
    await service.initialize();
    assert.equal(service.status().runtime, "wsl");
    assert.equal(service.status().qeRoot, "/usr/bin/pw.x");
    service.start = (job) => {
      job.status = "running";
      service.children.set(job.id, { simulated: true });
    };
    const submitted = await service.submit({
      name: "quartz-wsl",
      input: "&CONTROL\n calculation='scf'\n/\n",
      pseudopotentials: ["Si.pbe.UPF", "O.pbe.UPF"],
    });
    assert.equal(submitted.status, "running");
    assert.ok(calls.some((args) => args.includes("/bin/cp")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop Quantum ESPRESSO service detects pw.x and stages UPF files", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-qe-"));
  const qeRoot = join(root, "qe");
  const binRoot = join(qeRoot, "bin");
  const pseudoRoot = join(root, "pseudo");
  const workRoot = join(root, "jobs");
  await mkdir(binRoot, { recursive: true });
  await mkdir(pseudoRoot, { recursive: true });
  await writeFile(join(binRoot, "pw.exe"), "");
  await writeFile(join(binRoot, "ph.exe"), "");
  await writeFile(join(pseudoRoot, "Si.pbe.UPF"), "pseudo");
  try {
    assert.equal(detectQuantumEspressoRoot(qeRoot), resolve(qeRoot));
    assert.equal(quantumEspressoBinaries(qeRoot).pw, join(resolve(binRoot), "pw.exe"));
    assert.deepEqual(listPseudopotentials(pseudoRoot).map((item) => item.name), ["Si.pbe.UPF"]);
    const service = new QuantumEspressoDesktopService({ qeRoot, pseudoRoot, workRoot });
    await service.initialize();
    service.start = (job) => {
      job.status = "running";
      service.children.set(job.id, { simulated: true });
    };
    const submitted = await service.submit({
      name: "quartz",
      input: "&CONTROL\n calculation='scf'\n/\n",
      pseudopotentials: ["Si.pbe.UPF"],
    });
    assert.equal(submitted.status, "running");
    assert.equal(service.status().available, true);
    assert.equal(service.status().binaries.ph.available, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
