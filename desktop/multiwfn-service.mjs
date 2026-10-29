import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const supportedInputExtensions = new Set([
  ".chk", ".fch", ".fchk", ".wfn", ".wfx", ".mwfn", ".molden", ".mol", ".mol2", ".pdb", ".xyz", ".gjf", ".com", ".log", ".out", ".cube", ".cub",
]);

const ignoredArtifactNames = new Set(["settings.ini", "commands.txt", "multiwfn-output.txt"]);
const hartreeToEv = 27.211386245988;

export const multiwfnTaskTemplates = Object.freeze({
  summary: {
    id: "summary",
    label: "Wavefunction and structure summary",
    description: "Load the file, print the wavefunction/structure summary and exit.",
    script: "q\n",
  },
  aim: {
    id: "aim",
    label: "AIM topology and critical points",
    description: "Run the official batch topology workflow and export critical-point/path data.",
    script: "2\n2\n3\n4\n5\n8\n-4\n6\n0\n-5\n6\n0\n7\n-1\n-10\n100\n2\n1\nmol.pdb\nq\n",
  },
  espExtrema: {
    id: "esp-extrema",
    label: "ESP grid extrema",
    description: "Evaluate electrostatic-potential extrema on a spatial grid.",
    script: "5\n12\n4\n0.2\n0\nq\n",
  },
  resp: {
    id: "resp",
    label: "RESP atomic charges",
    description: "Calculate RESP charges and export a .chg file. RESP charge fitting does not itself create a Cube file.",
    script: "7\n18\n1\ny\n0\n0\nq\n",
  },
  frontierOrbitals: {
    id: "frontier-orbitals",
    label: "HOMO-LUMO energy levels",
    description: "Read the frontier-orbital indices and energies stored in a WFN or formatted-checkpoint file.",
    script: "q\n",
  },
  homoCube: {
    id: "homo-cube",
    label: "HOMO orbital Cube",
    description: "Detect the HOMO index and export its signed orbital-wavefunction grid as HOMO.cub.",
    script: "",
  },
  lumoCube: {
    id: "lumo-cube",
    label: "LUMO orbital Cube",
    description: "Detect the LUMO index and export its signed orbital-wavefunction grid as LUMO.cub.",
    script: "",
  },
  densityCube: {
    id: "density-cube",
    label: "Electron-density Cube",
    description: "Calculate electron density on a medium-quality 3D grid and export density.cub.",
    script: "5\n1\n2\n2\n0\nq\n",
  },
  espCube: {
    id: "esp-cube",
    label: "Electrostatic-potential Cube",
    description: "Calculate total electrostatic potential on a medium-quality 3D grid and export totesp.cub.",
    script: "5\n12\n2\n2\n0\nq\n",
  },
  custom: {
    id: "custom",
    label: "Custom command script",
    description: "Send one Multiwfn menu response per line. Add q when the workflow should return to the main menu and exit.",
    script: "",
  },
});

function numericTokens(text) {
  return String(text || "")
    .match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?/g)
    ?.map((value) => Number(value.replace(/[Dd]/g, "E")))
    .filter(Number.isFinite) ?? [];
}

function frontierOrbital(index, energyHartree) {
  return {
    index,
    energyHartree,
    energyEv: energyHartree * hartreeToEv,
  };
}

function frontierResult({ format, orbitalCount, homoIndex, homoEnergy, lumoIndex = null, lumoEnergy = null, note = "" }) {
  const homo = frontierOrbital(homoIndex, homoEnergy);
  const lumo = lumoIndex && Number.isFinite(lumoEnergy) ? frontierOrbital(lumoIndex, lumoEnergy) : null;
  return {
    format,
    orbitalCount,
    homo,
    lumo,
    gapHartree: lumo ? lumo.energyHartree - homo.energyHartree : null,
    gapEv: lumo ? lumo.energyEv - homo.energyEv : null,
    note,
  };
}

function fchkScalar(text, label) {
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(label));
  if (!line) return null;
  const match = line.match(/\bI\s+(-?\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function fchkArray(text, label) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((candidate) => candidate.startsWith(label));
  if (start < 0) return [];
  const countMatch = lines[start].match(/\bN=\s*(\d+)\s*$/);
  const count = Number(countMatch?.[1] ?? 0);
  if (!count) return [];
  const values = [];
  for (let index = start + 1; index < lines.length && values.length < count; index += 1) {
    values.push(...numericTokens(lines[index]));
  }
  return values.slice(0, count);
}

function inspectFchkFrontier(text, extension) {
  const alphaElectrons = fchkScalar(text, "Number of alpha electrons");
  const betaElectrons = fchkScalar(text, "Number of beta electrons");
  const alphaEnergies = fchkArray(text, "Alpha Orbital Energies");
  const betaEnergies = fchkArray(text, "Beta Orbital Energies");
  if (!Number.isInteger(alphaElectrons) || !Number.isInteger(betaElectrons) || !alphaEnergies.length) {
    throw new Error("The formatted checkpoint file does not contain the electron counts and alpha orbital energies needed for HOMO-LUMO analysis.");
  }
  if (alphaElectrons !== betaElectrons || betaEnergies.length) {
    throw new Error("Automatic HOMO/LUMO Cube generation currently supports restricted closed-shell formatted checkpoint files. Use a custom Multiwfn script for open-shell orbitals.");
  }
  const homoIndex = alphaElectrons;
  const lumoIndex = homoIndex + 1;
  if (homoIndex < 1 || !Number.isFinite(alphaEnergies[homoIndex - 1])) {
    throw new Error("The HOMO energy could not be located in the formatted checkpoint file.");
  }
  const hasLumo = Number.isFinite(alphaEnergies[lumoIndex - 1]);
  return frontierResult({
    format: extension.slice(1).toUpperCase(),
    orbitalCount: alphaEnergies.length,
    homoIndex,
    homoEnergy: alphaEnergies[homoIndex - 1],
    lumoIndex: hasLumo ? lumoIndex : null,
    lumoEnergy: hasLumo ? alphaEnergies[lumoIndex - 1] : null,
    note: hasLumo ? "" : "This formatted checkpoint file contains no virtual orbital after the HOMO.",
  });
}

function inspectWfnFrontier(text) {
  const orbitals = [];
  const pattern = /^MO\s+(\d+)\b[\s\S]*?OCC NO\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?)\s+ORB\. ENERGY\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?)/gm;
  for (const match of text.matchAll(pattern)) {
    orbitals.push({
      index: Number(match[1]),
      occupancy: Number(match[2].replace(/[Dd]/g, "E")),
      energy: Number(match[3].replace(/[Dd]/g, "E")),
    });
  }
  const occupied = orbitals.filter((orbital) => orbital.occupancy > 1e-7 && Number.isFinite(orbital.energy));
  if (!occupied.length) throw new Error("The WFN file does not contain readable occupied molecular orbitals.");
  const homoRecord = occupied.reduce((highest, orbital) => orbital.energy >= highest.energy ? orbital : highest);
  const virtual = orbitals
    .filter((orbital) => orbital.occupancy <= 1e-7 && orbital.index > homoRecord.index && Number.isFinite(orbital.energy))
    .sort((a, b) => a.energy - b.energy)[0] ?? null;
  return frontierResult({
    format: "WFN",
    orbitalCount: orbitals.length,
    homoIndex: homoRecord.index,
    homoEnergy: homoRecord.energy,
    lumoIndex: virtual?.index ?? null,
    lumoEnergy: virtual?.energy ?? null,
    note: virtual ? "" : "Standard WFN files commonly contain occupied orbitals only; no LUMO is present. Export an FCHK/FCH file containing virtual orbitals to generate the LUMO.",
  });
}

export async function inspectFrontierOrbitals(inputPath) {
  const source = validateMultiwfnInput(inputPath);
  const extension = extname(source).toLowerCase();
  const text = await readFile(source, "utf8");
  if (extension === ".fch" || extension === ".fchk") return inspectFchkFrontier(text, extension);
  if (extension === ".wfn") return inspectWfnFrontier(text);
  throw new Error("Automatic HOMO-LUMO detection currently supports .fch, .fchk and .wfn files. Convert this wavefunction to FCHK or use a custom Multiwfn script.");
}

function orbitalCubeScript(index) {
  return `5\n4\n${index}\n2\n2\n0\nq\n`;
}

function safeStem(value, fallback = "multiwfn-job") {
  const normalized = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function nestedMultiwfnRoots(directory) {
  if (!directory || !existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Multiwfn(?:_|-)/i.test(entry.name))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

export function multiwfnBinaries(root) {
  const normalized = root ? resolve(root) : "";
  return {
    root: normalized,
    multiwfn: normalized ? join(normalized, "Multiwfn.exe") : "",
    settings: normalized ? join(normalized, "settings.ini") : "",
  };
}

export function detectMultiwfnRoot(preferredRoot = "", searchRoots = []) {
  const bases = [
    preferredRoot,
    process.env.SYMVIZ_MULTIWFN_ROOT,
    ...searchRoots,
    process.cwd(),
  ].filter(Boolean).map((item) => resolve(item));
  const candidates = [...new Set([
    ...bases,
    ...bases.flatMap(nestedMultiwfnRoots),
  ])];
  return candidates.find((candidate) => existsSync(multiwfnBinaries(candidate).multiwfn)) ?? "";
}

export function validateMultiwfnInput(path) {
  const normalized = path ? resolve(path) : "";
  if (!normalized || !existsSync(normalized)) throw new Error("The selected Multiwfn input file does not exist.");
  const extension = extname(normalized).toLowerCase();
  if (!supportedInputExtensions.has(extension)) {
    throw new Error(`Unsupported Multiwfn input format: ${extension || "no extension"}.`);
  }
  return normalized;
}

function publicJob(job, artifacts = []) {
  return {
    id: job.id,
    name: job.name,
    taskId: job.taskId,
    inputName: job.inputName,
    status: job.status,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    error: job.error,
    directory: job.directory,
    files: { ...job.files },
    frontier: job.frontier ?? null,
    artifacts,
  };
}

function terminateProcessTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return Promise.resolve(true);
  if (process.platform !== "win32") return Promise.resolve(child.kill("SIGTERM"));
  return new Promise((resolveTermination) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      if (!success && child.exitCode === null) child.kill();
      resolveTermination(success);
    };
    killer.once("error", () => finish(false));
    killer.once("close", (code) => finish(code === 0));
  });
}

export class MultiwfnDesktopService {
  constructor({ workRoot, multiwfnRoot = "", searchRoots = [], onUpdate = () => {} }) {
    this.workRoot = resolve(workRoot);
    this.searchRoots = searchRoots.map((item) => resolve(item));
    this.multiwfnRoot = detectMultiwfnRoot(multiwfnRoot, this.searchRoots);
    this.onUpdate = onUpdate;
    this.jobs = new Map();
    this.children = new Map();
    this.starting = false;
    this.indexPath = join(this.workRoot, "jobs.json");
  }

  async initialize() {
    await mkdir(this.workRoot, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.indexPath, "utf8"));
      for (const stored of Array.isArray(saved.jobs) ? saved.jobs : []) {
        const interrupted = stored.status === "running";
        this.jobs.set(stored.id, {
          ...stored,
          status: interrupted ? "failed" : stored.status,
          error: interrupted ? "The previous desktop session ended before this Multiwfn task completed." : stored.error,
        });
      }
      await this.persist();
    } catch {
      // A new installation has no task index yet.
    }
    void this.pumpQueue();
    return this.status();
  }

  status() {
    this.multiwfnRoot = detectMultiwfnRoot(this.multiwfnRoot, this.searchRoots);
    const binaries = multiwfnBinaries(this.multiwfnRoot);
    return {
      desktop: true,
      version: "0.1.3",
      multiwfnVersion: this.multiwfnRoot.match(/Multiwfn[_-]([^\\/]+?)(?:_bin|$)/i)?.[1] || "",
      workRoot: this.workRoot,
      multiwfnRoot: this.multiwfnRoot,
      available: Boolean(binaries.multiwfn && existsSync(binaries.multiwfn)),
      binaries: {
        multiwfn: { path: binaries.multiwfn, available: Boolean(binaries.multiwfn && existsSync(binaries.multiwfn)) },
        settings: { path: binaries.settings, available: Boolean(binaries.settings && existsSync(binaries.settings)) },
      },
      templates: Object.values(multiwfnTaskTemplates).map(({ script: _script, ...template }) => template),
    };
  }

  setMultiwfnRoot(root) {
    const candidate = detectMultiwfnRoot(root, []);
    if (!candidate || resolve(candidate).toLowerCase() !== resolve(root).toLowerCase()) {
      throw new Error("The selected folder does not contain Multiwfn.exe.");
    }
    this.multiwfnRoot = candidate;
    return this.status();
  }

  getJob(id) {
    const job = this.jobs.get(String(id));
    if (!job) throw new Error("Multiwfn job not found.");
    return job;
  }

  artifactsFor(job) {
    try {
      return readdirSync(job.directory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .filter((entry) => !ignoredArtifactNames.has(entry.name.toLowerCase()))
        .filter((entry) => entry.name.toLowerCase() !== job.inputName.toLowerCase())
        .map((entry) => ({
          name: entry.name,
          path: join(job.directory, entry.name),
          kind: /\.(cube|cub)$/i.test(entry.name) ? "cube" : /\.(pdb|xyz|mol2?)$/i.test(entry.name) ? "structure" : "result",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  listJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map((job) => publicJob(job, this.artifactsFor(job)));
  }

  async persist() {
    await writeFile(this.indexPath, JSON.stringify({ version: 1, jobs: [...this.jobs.values()] }, null, 2), "utf8");
  }

  async emit(job) {
    await this.persist();
    this.onUpdate(publicJob(job, this.artifactsFor(job)));
  }

  async submit({ name, inputPath, taskId = "summary", script = "" }) {
    const binaries = multiwfnBinaries(this.multiwfnRoot);
    if (!binaries.multiwfn || !existsSync(binaries.multiwfn)) {
      throw new Error("Multiwfn was not detected. Select the folder containing Multiwfn.exe.");
    }
    const source = validateMultiwfnInput(inputPath);
    const template = Object.values(multiwfnTaskTemplates).find((item) => item.id === taskId) ?? multiwfnTaskTemplates.custom;
    let frontier = null;
    if (["frontier-orbitals", "homo-cube", "lumo-cube"].includes(template.id)) {
      frontier = await inspectFrontierOrbitals(source);
    }
    if (template.id === "lumo-cube" && !frontier?.lumo) {
      throw new Error(`${frontier?.note || "The selected file does not contain a LUMO."} LUMO Cube generation was not started.`);
    }
    const commandScript = taskId === "custom"
      ? String(script || "")
      : template.id === "homo-cube"
        ? orbitalCubeScript(frontier.homo.index)
        : template.id === "lumo-cube"
          ? orbitalCubeScript(frontier.lumo.index)
          : template.script;
    if (!commandScript.trim()) throw new Error("The Multiwfn command script is empty.");
    if (commandScript.length > 1_000_000) throw new Error("The Multiwfn command script exceeds the 1 MB safety limit.");
    const id = randomUUID();
    const stem = safeStem(name || basename(source), `multiwfn-${id.slice(0, 8)}`);
    const directory = join(this.workRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${stem}-${id.slice(0, 8)}`);
    await mkdir(directory, { recursive: true });
    const inputName = basename(source);
    const job = {
      id,
      name: stem,
      taskId: template.id,
      inputName,
      status: "queued",
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      exitCode: null,
      error: null,
      frontier,
      generatedArtifactName: template.id === "homo-cube" ? "HOMO.cub" : template.id === "lumo-cube" ? "LUMO.cub" : null,
      directory,
      files: {
        input: join(directory, inputName),
        script: join(directory, "commands.txt"),
        output: join(directory, "multiwfn-output.txt"),
      },
    };
    await copyFile(source, job.files.input);
    if (existsSync(binaries.settings)) await copyFile(binaries.settings, join(directory, "settings.ini"));
    await writeFile(job.files.script, commandScript.replace(/\r\n/g, "\n").replace(/\n?$/, "\n"), "utf8");
    this.jobs.set(id, job);
    await this.emit(job);
    void this.pumpQueue();
    return publicJob(job, []);
  }

  async pumpQueue() {
    if (this.starting || this.children.size > 0) return;
    const next = [...this.jobs.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
    if (!next) return;
    this.starting = true;
    try {
      await this.start(next);
    } finally {
      this.starting = false;
    }
  }

  async start(job) {
    const binaries = multiwfnBinaries(this.multiwfnRoot);
    const commandScript = await readFile(job.files.script, "utf8");
    const outputStream = createWriteStream(job.files.output, { flags: "w" });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    await this.emit(job);
    const environment = { ...process.env, Multiwfnpath: this.multiwfnRoot };
    const child = spawn(binaries.multiwfn, [job.files.input], {
      cwd: job.directory,
      env: environment,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.children.set(job.id, child);
    child.stdout.pipe(outputStream, { end: false });
    child.stderr.pipe(outputStream, { end: false });
    let spawnError = null;
    child.once("error", (error) => { spawnError = error; });
    child.stdin.end(commandScript);
    child.once("close", async (exitCode, signal) => {
      await new Promise((resolve) => outputStream.end(resolve));
      job.exitCode = exitCode;
      job.completedAt = new Date().toISOString();
      this.children.delete(job.id);
      if (job.status === "cancelled") {
        await this.emit(job);
        await this.pumpQueue();
        return;
      }
      job.status = exitCode === 0 ? "completed" : "failed";
      if (job.status === "completed" && job.generatedArtifactName) {
        const generated = join(job.directory, "MOvalue.cub");
        if (existsSync(generated)) await rename(generated, join(job.directory, job.generatedArtifactName));
      }
      job.error = job.status === "failed"
        ? spawnError?.message || `Multiwfn exited with code ${exitCode ?? "unknown"}${signal ? ` (${signal})` : ""}. Check the live output and command script.`
        : null;
      await this.emit(job);
      await this.pumpQueue();
    });
  }

  async cancel(id) {
    const job = this.getJob(id);
    const child = this.children.get(job.id);
    if (child && job.status === "running") {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      await this.emit(job);
      const terminated = await terminateProcessTree(child);
      if (!terminated) throw new Error("Windows could not confirm termination of the Multiwfn process tree.");
    } else if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      await this.emit(job);
      await this.pumpQueue();
    }
    return publicJob(job, this.artifactsFor(job));
  }

  output(id) {
    const job = this.getJob(id);
    return readFile(job.files.output, "utf8").catch(() => "");
  }

  async outputTail(id, requestedBytes = 240_000) {
    const job = this.getJob(id);
    const maxBytes = Math.min(1_000_000, Math.max(16_384, Number(requestedBytes) || 240_000));
    try {
      const info = await stat(job.files.output);
      const start = Math.max(0, info.size - maxBytes);
      const length = info.size - start;
      const handle = await open(job.files.output, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        let text = buffer.toString("utf8");
        if (start > 0) text = text.replace(/^[^\r\n]*(?:\r?\n|\r)/, "");
        return { text, size: info.size, truncated: start > 0, updatedAt: info.mtime.toISOString() };
      } finally {
        await handle.close();
      }
    } catch {
      return { text: "", size: 0, truncated: false, updatedAt: null };
    }
  }

  async readArtifact(id, artifactName) {
    const job = this.getJob(id);
    const safeName = basename(String(artifactName || ""));
    const artifact = this.artifactsFor(job).find((item) => item.name === safeName);
    if (!artifact) throw new Error("Multiwfn artifact not found.");
    const info = await stat(artifact.path);
    if (info.size > 250_000_000) throw new Error("This artifact exceeds the 250 MB in-app preview limit.");
    return { ...artifact, text: await readFile(artifact.path, "utf8"), size: info.size };
  }
}
