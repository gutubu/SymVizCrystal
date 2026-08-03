import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const allowedCubeProperties = new Map([
  ["density", "Density=SCF"],
  ["esp", "Potential=SCF"],
  ["homo", "MO=Homo"],
  ["lumo", "MO=Lumo"],
]);

export function safeJobStem(value, fallback = "symviz-job") {
  const normalized = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function gaussianBinaries(root) {
  const normalized = root ? resolve(root) : "";
  return {
    root: normalized,
    g16: normalized ? join(normalized, "g16.exe") : "",
    formchk: normalized ? join(normalized, "formchk.exe") : "",
    cubegen: normalized ? join(normalized, "cubegen.exe") : "",
  };
}

export function detectGaussianRoot(preferredRoot = "") {
  const candidates = [
    preferredRoot,
    process.env.SYMVIZ_GAUSSIAN_ROOT,
    "C:\\G16W",
    "C:\\Gaussian\\G16W",
    "C:\\Program Files\\Gaussian\\G16W",
    "C:\\Program Files\\Gaussian\\g16",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(gaussianBinaries(candidate).g16)) ?? "";
}

export function gaussianProcessEnvironment(root, scratchDirectory) {
  const normalizedRoot = resolve(root);
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
  environment.GAUSS_EXEDIR = normalizedRoot;
  environment.GAUSS_LEXEDIR = normalizedRoot;
  environment.GAUSS_SCRDIR = resolve(scratchDirectory);
  environment[pathKey] = [normalizedRoot, environment[pathKey]].filter(Boolean).join(";");
  return environment;
}

function publicJob(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    error: job.error,
    directory: job.directory,
    files: {
      input: job.files.input,
      output: job.files.output,
      checkpoint: job.files.checkpoint,
      formattedCheckpoint: job.files.formattedCheckpoint,
      densityCube: job.files.densityCube ?? null,
      espCube: job.files.espCube ?? null,
      homoCube: job.files.homoCube ?? null,
      lumoCube: job.files.lumoCube ?? null,
    },
  };
}

async function runProcess(executable, args, cwd, environment = process.env) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectProcess);
    child.once("close", (exitCode, signal) => resolveProcess({ exitCode, signal, stdout, stderr }));
  });
}

export function processTreeKillCommand(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) throw new Error("Invalid process id.");
  return { executable: "taskkill.exe", args: ["/PID", String(normalizedPid), "/T", "/F"] };
}

async function terminateProcessTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return true;
  if (process.platform !== "win32") return child.kill("SIGTERM");
  const command = processTreeKillCommand(child.pid);
  return new Promise((resolveTermination) => {
    const killer = spawn(command.executable, command.args, {
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
    killer.once("close", (exitCode) => finish(exitCode === 0));
  });
}

export class GaussianDesktopService {
  constructor({ workRoot, gaussianRoot = "", onUpdate = () => {} }) {
    this.workRoot = resolve(workRoot);
    this.gaussianRoot = detectGaussianRoot(gaussianRoot);
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
        const job = {
          ...stored,
          status: interrupted ? "failed" : stored.status,
          error: interrupted
            ? "The previous desktop session ended before this task completed."
            : stored.error,
        };
        this.jobs.set(job.id, job);
      }
      await this.persist();
    } catch {
      // A new installation has no task index yet.
    }
    void this.pumpQueue();
    return this.status();
  }

  status() {
    const binaries = gaussianBinaries(this.gaussianRoot);
    return {
      desktop: true,
      version: "0.1.3",
      workRoot: this.workRoot,
      gaussianRoot: this.gaussianRoot,
      available: Boolean(this.gaussianRoot && existsSync(binaries.g16)),
      binaries: {
        g16: { path: binaries.g16, available: Boolean(binaries.g16 && existsSync(binaries.g16)) },
        formchk: { path: binaries.formchk, available: Boolean(binaries.formchk && existsSync(binaries.formchk)) },
        cubegen: { path: binaries.cubegen, available: Boolean(binaries.cubegen && existsSync(binaries.cubegen)) },
      },
    };
  }

  setGaussianRoot(root) {
    const candidate = detectGaussianRoot(root);
    if (!candidate || resolve(candidate).toLowerCase() !== resolve(root).toLowerCase()) {
      throw new Error("The selected folder does not contain g16.exe.");
    }
    this.gaussianRoot = candidate;
    return this.status();
  }

  listJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(publicJob);
  }

  getJob(id) {
    const job = this.jobs.get(String(id));
    if (!job) throw new Error("Gaussian job not found.");
    return job;
  }

  async persist() {
    await writeFile(this.indexPath, JSON.stringify({
      version: 1,
      jobs: [...this.jobs.values()],
    }, null, 2), "utf8");
  }

  async emit(job) {
    await this.persist();
    this.onUpdate(publicJob(job));
  }

  async submit({ name, input }) {
    const binaries = gaussianBinaries(this.gaussianRoot);
    if (!binaries.g16 || !existsSync(binaries.g16)) {
      throw new Error("Gaussian 16 was not detected. Select the folder containing g16.exe.");
    }
    if (typeof input !== "string" || !input.trim()) throw new Error("Gaussian input is empty.");
    if (input.length > 2_000_000) throw new Error("Gaussian input is larger than the 2 MB safety limit.");
    const inputHash = createHash("sha256").update(input.replace(/\r\n/g, "\n").trim()).digest("hex");
    const duplicate = [...this.jobs.values()].find((candidate) =>
      ["queued", "running"].includes(candidate.status) && candidate.inputHash === inputHash);
    if (duplicate) return publicJob(duplicate);
    const id = randomUUID();
    const stem = safeJobStem(name, `symviz-${id.slice(0, 8)}`);
    const directory = join(this.workRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${stem}-${id.slice(0, 8)}`);
    await mkdir(directory, { recursive: true });
    const checkpointMatches = [...input.matchAll(/^\s*%chk\s*=\s*(.+)$/gim)];
    const checkpointStem = safeJobStem(checkpointMatches.at(-1)?.[1]?.trim(), stem);
    const job = {
      id,
      name: stem,
      status: "queued",
      submittedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      exitCode: null,
      error: null,
      inputHash,
      directory,
      files: {
        input: join(directory, `${stem}.gjf`),
        output: join(directory, `${stem}.log`),
        checkpoint: join(directory, `${checkpointStem}.chk`),
        formattedCheckpoint: join(directory, `${stem}.fchk`),
      },
    };
    await writeFile(job.files.input, input, "utf8");
    this.jobs.set(id, job);
    await this.emit(job);
    void this.pumpQueue();
    return publicJob(job);
  }

  async pumpQueue() {
    if (this.starting || this.children.size > 0) return;
    const next = [...this.jobs.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
    if (!next) return;
    this.starting = true;
    try {
      this.start(next);
    } finally {
      this.starting = false;
    }
  }

  start(job) {
    const binaries = gaussianBinaries(this.gaussianRoot);
    const scratchDirectory = join(job.directory, "scratch");
    mkdirSync(scratchDirectory, { recursive: true });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    void this.emit(job);
    const child = spawn(binaries.g16, [job.files.input, job.files.output], {
      cwd: job.directory,
      env: gaussianProcessEnvironment(this.gaussianRoot, scratchDirectory),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(job.id, child);
    let stderr = "";
    let spawnError = null;
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", async (exitCode, signal) => {
      job.exitCode = exitCode;
      job.completedAt = new Date().toISOString();
      this.children.delete(job.id);
      if (job.status === "cancelled") {
        await this.emit(job);
        await this.pumpQueue();
        return;
      }
      let output = "";
      try {
        output = await readFile(job.files.output, "utf8");
      } catch {
        // Gaussian may fail before it creates an output file.
      }
      job.status = exitCode === 0 && /Normal termination of Gaussian/i.test(output) ? "completed" : "failed";
      job.error = job.status === "failed"
        ? spawnError?.message || stderr.trim() || `Gaussian exited with code ${exitCode ?? "unknown"}${signal ? ` (${signal})` : ""}.`
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
      const treeTerminated = await terminateProcessTree(child);
      if (!treeTerminated) {
        job.error = "The Gaussian controller stopped, but Windows could not confirm that every Link child process was terminated.";
        await this.emit(job);
        throw new Error(job.error);
      }
    } else if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      await this.emit(job);
      await this.pumpQueue();
    }
    return publicJob(job);
  }

  async output(id) {
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

  async generateCube(id, property) {
    const job = this.getJob(id);
    if (job.status !== "completed") throw new Error("The Gaussian job must complete before a Cube file can be generated.");
    const cubeKeyword = allowedCubeProperties.get(String(property));
    if (!cubeKeyword) throw new Error("Unsupported Cube property.");
    const binaries = gaussianBinaries(this.gaussianRoot);
    if (!existsSync(job.files.checkpoint)) throw new Error("The Gaussian checkpoint file is not available.");
    if (!existsSync(binaries.formchk) || !existsSync(binaries.cubegen)) {
      throw new Error("formchk.exe or cubegen.exe was not found in the Gaussian folder.");
    }
    const scratchDirectory = join(job.directory, "scratch");
    await mkdir(scratchDirectory, { recursive: true });
    const environment = gaussianProcessEnvironment(this.gaussianRoot, scratchDirectory);
    const formchkResult = await runProcess(binaries.formchk, [job.files.checkpoint, job.files.formattedCheckpoint], job.directory, environment);
    if (formchkResult.exitCode !== 0) {
      throw new Error(formchkResult.stderr.trim() || formchkResult.stdout.trim() || "formchk failed.");
    }
    const cubePath = join(job.directory, `${safeJobStem(job.name)}-${property}.cube`);
    const cubeResult = await runProcess(
      binaries.cubegen,
      ["0", cubeKeyword, job.files.formattedCheckpoint, cubePath, "-2", "h"],
      job.directory,
      environment,
    );
    if (cubeResult.exitCode !== 0) {
      throw new Error(cubeResult.stderr.trim() || cubeResult.stdout.trim() || "cubegen failed.");
    }
    job.files[`${property}Cube`] = cubePath;
    await this.emit(job);
    return { property, fileName: basename(cubePath), path: cubePath };
  }

  async readCube(id, property) {
    const job = this.getJob(id);
    const path = job.files[`${property}Cube`];
    if (!path || !existsSync(path)) throw new Error(`The ${property} Cube file has not been generated.`);
    return { fileName: basename(path), text: await readFile(path, "utf8") };
  }
}
