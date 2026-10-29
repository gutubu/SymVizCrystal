import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { copyFile, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const wslExecutable = join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe");

export function decodeProcessOutput(buffer) {
  if (!buffer?.length) return "";
  const sample = buffer.subarray(0, Math.min(buffer.length, 256));
  const nulBytes = [...sample].filter((value) => value === 0).length;
  return buffer.toString(nulBytes > sample.length / 8 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
}

function normalizedDiagnostic(value) {
  return String(value || "").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
}

function isWslProxyWarning(line) {
  return /^wsl:/i.test(line) && /localhost/i.test(line) && /(?:proxy|代理)/i.test(line) && /(?:NAT|WSL)/i.test(line);
}

export function readableProcessError(value) {
  const lines = normalizedDiagnostic(value).split("\n").map((line) => line.trim()).filter(Boolean);
  const actionable = lines.filter((line) => !isWslProxyWarning(line));
  return (actionable.length ? actionable : []).join("\n");
}

export function normalizeStoredQeError(value) {
  const raw = String(value || "");
  if (/w\0s\0l\0:/i.test(raw) && /l\0o\0c\0a\0l\0h\0o\0s\0t/i.test(raw)) {
    return "pw.x did not start. The previous WSL launcher returned before executing the Quantum ESPRESSO command.";
  }
  return normalizedDiagnostic(raw) || null;
}

export function wslLaunchArguments({ distro, directory, pw }) {
  return [
    "--distribution", distro,
    "--exec", "/usr/bin/setsid", "--wait", "/bin/bash", "-c",
    "cd \"$1\" || { printf 'SymViz: cannot enter QE job directory: %s\\n' \"$1\" >&2; exit 125; }; echo $$ > .symviz-qe.pid; exec \"$2\"",
    "symviz-qe", directory, pw,
  ];
}

export function wslCancelArguments({ distro, directory }) {
  return [
    "--distribution", distro,
    "--exec", "/bin/bash", "-c",
    "cd \"$1\" || exit 125; if [ -s .symviz-qe.pid ]; then p=$(cat .symviz-qe.pid); kill -TERM -- -\"$p\" 2>/dev/null || true; for i in 1 2 3 4 5; do kill -0 \"$p\" 2>/dev/null || exit 0; sleep 0.2; done; kill -KILL -- -\"$p\" 2>/dev/null || true; fi",
    "symviz-qe-cancel", directory,
  ];
}

function runCapturedProcess(executable, args, { cwd, input, timeoutMs = 30_000 } = {}) {
  return new Promise((resolveRun) => {
    let stdout = [];
    let stderr = [];
    let settled = false;
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        ...result,
        stdout: decodeProcessOutput(Buffer.concat(stdout)),
        stderr: decodeProcessOutput(Buffer.concat(stderr)),
      });
    };
    child.once("error", (error) => finish({ exitCode: null, error }));
    child.once("close", (exitCode, signal) => finish({ exitCode, signal, error: null }));
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

function uniqueLines(value) {
  return [...new Set(String(value || "").split(/\r?\n/).map((line) => line.replace(/\0/g, "").trim()).filter(Boolean))];
}

export async function discoverWslQuantumEspresso(preferredDistro = "Ubuntu", runner = runCapturedProcess) {
  if (process.platform !== "win32" || !existsSync(wslExecutable)) return null;
  const listed = await runner(wslExecutable, ["--list", "--quiet"]).catch(() => ({ stdout: "" }));
  const distributions = [...new Set([preferredDistro, ...uniqueLines(listed.stdout)])].filter(Boolean);
  const commandNames = ["pw", "ph", "pp", "bands", "dos", "projwfc"];
  for (const distro of distributions) {
    const commands = commandNames.map((name) => `printf '${name}='; command -v ${name}.x || true`).join("; ");
    const located = await runner(wslExecutable, ["--distribution", distro, "--exec", "/bin/sh", "-c", commands]).catch(() => null);
    if (!located || located.exitCode !== 0) continue;
    const binaries = Object.fromEntries(uniqueLines(located.stdout).map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    if (!binaries.pw) continue;
    const versionResult = await runner(wslExecutable, ["--distribution", distro, "--exec", binaries.pw, "-h"], { timeoutMs: 30_000 }).catch(() => null);
    const versionText = `${versionResult?.stdout || ""}\n${versionResult?.stderr || ""}`;
    const version = versionText.match(/Program\s+PWSCF\s+v\.([^\s]+)/i)?.[1] || "";
    const pseudoResult = await runner(wslExecutable, [
      "--distribution", distro, "--exec", "/bin/sh", "-c",
      "{ command -v dpkg >/dev/null 2>&1 && dpkg -L quantum-espresso-data-sssp 2>/dev/null || true; } | grep -i '\\.upf$'",
    ]).catch(() => null);
    const pseudopotentials = uniqueLines(pseudoResult?.stdout).map((path) => ({ name: path.split("/").at(-1), path }));
    const pseudoRoot = pseudopotentials[0]?.path.replace(/\/[^/]+$/, "") || "";
    return { distro, binaries, version, pseudopotentials, pseudoRoot };
  }
  return null;
}

function safeJobStem(value, fallback = "symviz-qe") {
  const normalized = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function binaryCandidates(root, names) {
  if (!root) return [];
  const normalized = resolve(root);
  return [normalized, join(normalized, "bin")].flatMap((directory) => names.map((name) => join(directory, name)));
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) ?? "";
}

export function quantumEspressoBinaries(root) {
  const normalized = root ? resolve(root) : "";
  const binary = (names) => firstExisting(binaryCandidates(normalized, names));
  return {
    root: normalized,
    pw: binary(["pw.exe", "pw.x"]),
    ph: binary(["ph.exe", "ph.x"]),
    pp: binary(["pp.exe", "pp.x"]),
    bands: binary(["bands.exe", "bands.x"]),
    dos: binary(["dos.exe", "dos.x"]),
    projwfc: binary(["projwfc.exe", "projwfc.x"]),
  };
}

export function detectQuantumEspressoRoot(preferredRoot = "") {
  const candidates = [
    preferredRoot,
    process.env.SYMVIZ_QE_ROOT,
    "C:\\QuantumESPRESSO",
    "C:\\QE",
    "C:\\Program Files\\Quantum ESPRESSO",
    "C:\\Program Files\\QuantumESPRESSO",
  ].filter(Boolean);
  return candidates.find((candidate) => Boolean(quantumEspressoBinaries(candidate).pw)) ?? "";
}

export function listPseudopotentials(root, maximum = 2000) {
  if (!root || !existsSync(root)) return [];
  const files = [];
  const visit = (directory, depth) => {
    if (depth > 2 || files.length >= maximum) return;
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maximum) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else if (/\.upf$/i.test(entry.name)) files.push({ name: entry.name, path });
    }
  };
  visit(resolve(root), 0);
  return files.sort((a, b) => a.name.localeCompare(b.name));
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
    files: { ...job.files },
    study: job.study ? { ...job.study } : null,
  };
}

function normalizedStudyMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind === "k-point" || value.kind === "cutoff" ? value.kind : null;
  const id = String(value.id || "").replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 80);
  if (!kind || !id) return null;
  const kPoints = Array.isArray(value.kPoints) && value.kPoints.length === 3
    ? value.kPoints.map((item) => Math.max(1, Math.round(Number(item) || 1))).slice(0, 3)
    : null;
  const numeric = (item) => Number.isFinite(Number(item)) ? Number(item) : null;
  return {
    id,
    kind,
    label: String(value.label || "").slice(0, 120),
    sequenceIndex: Math.max(0, Math.round(Number(value.sequenceIndex) || 0)),
    sequenceTotal: Math.max(1, Math.round(Number(value.sequenceTotal) || 1)),
    atomCount: Math.max(1, Math.round(Number(value.atomCount) || 1)),
    kPoints,
    ecutwfcRy: numeric(value.ecutwfcRy),
    ecutrhoRy: numeric(value.ecutrhoRy),
  };
}

function processTreeKillCommand(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) throw new Error("Invalid process id.");
  return { executable: "taskkill.exe", args: ["/PID", String(normalizedPid), "/T", "/F"] };
}

async function terminateProcessTree(child) {
  if (!child || !child.pid || child.exitCode !== null) return true;
  if (process.platform !== "win32") return child.kill("SIGTERM");
  const command = processTreeKillCommand(child.pid);
  return new Promise((resolveTermination) => {
    const killer = spawn(command.executable, command.args, { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
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

export class QuantumEspressoDesktopService {
  constructor({ workRoot, qeRoot = "", pseudoRoot = "", wslDistro = "Ubuntu", onUpdate = () => {}, commandRunner = runCapturedProcess }) {
    this.workRoot = resolve(workRoot);
    this.qeRoot = detectQuantumEspressoRoot(qeRoot);
    this.pseudoRoot = pseudoRoot && existsSync(pseudoRoot) ? resolve(pseudoRoot) : "";
    this.wslDistro = wslDistro || "Ubuntu";
    this.wslRuntime = null;
    this.onUpdate = onUpdate;
    this.commandRunner = commandRunner;
    this.jobs = new Map();
    this.children = new Map();
    this.starting = false;
    this.indexPath = join(this.workRoot, "jobs.json");
  }

  async initialize() {
    await mkdir(this.workRoot, { recursive: true });
    if (!quantumEspressoBinaries(this.qeRoot).pw) {
      this.wslRuntime = await discoverWslQuantumEspresso(this.wslDistro, this.commandRunner).catch(() => null);
      if (this.wslRuntime?.distro) this.wslDistro = this.wslRuntime.distro;
    }
    try {
      const saved = JSON.parse(await readFile(this.indexPath, "utf8"));
      for (const stored of Array.isArray(saved.jobs) ? saved.jobs : []) {
        const interrupted = stored.status === "running";
        this.jobs.set(stored.id, {
          ...stored,
          status: interrupted ? "failed" : stored.status,
          error: interrupted
            ? "The previous desktop session ended before this Quantum ESPRESSO task completed."
            : normalizeStoredQeError(stored.error),
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
    const nativeBinaries = quantumEspressoBinaries(this.qeRoot);
    const runtime = nativeBinaries.pw ? "native" : this.wslRuntime?.binaries?.pw ? "wsl" : "none";
    const binaries = runtime === "native"
      ? Object.fromEntries(Object.entries(nativeBinaries)
        .filter(([name]) => name !== "root")
        .map(([name, path]) => [name, { path, available: Boolean(path) }]))
      : Object.fromEntries(["pw", "ph", "pp", "bands", "dos", "projwfc"].map((name) => {
        const path = this.wslRuntime?.binaries?.[name] || "";
        return [name, { path, available: Boolean(path) }];
      }));
    const nativePseudos = listPseudopotentials(this.pseudoRoot);
    const pseudos = nativePseudos.length ? nativePseudos : this.wslRuntime?.pseudopotentials || [];
    return {
      desktop: true,
      version: "0.1.3",
      workRoot: this.workRoot,
      runtime,
      qeRoot: runtime === "native" ? this.qeRoot : this.wslRuntime?.binaries?.pw || "",
      pseudoRoot: this.pseudoRoot || this.wslRuntime?.pseudoRoot || "",
      wslDistro: runtime === "wsl" ? this.wslRuntime.distro : "",
      qeVersion: runtime === "wsl" ? this.wslRuntime.version : "",
      available: runtime !== "none",
      binaries,
      pseudopotentials: pseudos.map((item) => item.name),
    };
  }

  setQeRoot(root) {
    const candidate = detectQuantumEspressoRoot(root);
    if (!candidate || resolve(candidate).toLowerCase() !== resolve(root).toLowerCase()) {
      throw new Error("The selected folder does not contain pw.exe/pw.x, either directly or in a bin folder.");
    }
    this.qeRoot = candidate;
    return this.status();
  }

  async refreshRuntime() {
    if (!quantumEspressoBinaries(this.qeRoot).pw) {
      this.wslRuntime = await discoverWslQuantumEspresso(this.wslDistro, this.commandRunner).catch(() => null);
      if (this.wslRuntime?.distro) this.wslDistro = this.wslRuntime.distro;
    }
    return this.status();
  }

  setPseudoRoot(root) {
    const normalized = resolve(root);
    if (!existsSync(normalized)) throw new Error("The selected pseudopotential folder does not exist.");
    const files = listPseudopotentials(normalized);
    if (!files.length) throw new Error("The selected folder does not contain any .UPF pseudopotentials.");
    this.pseudoRoot = normalized;
    return this.status();
  }

  listJobs() {
    return [...this.jobs.values()]
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(publicJob);
  }

  getJob(id) {
    const job = this.jobs.get(String(id));
    if (!job) throw new Error("Quantum ESPRESSO job not found.");
    return job;
  }

  async persist() {
    await writeFile(this.indexPath, JSON.stringify({ version: 1, jobs: [...this.jobs.values()] }, null, 2), "utf8");
  }

  async emit(job) {
    await this.persist();
    this.onUpdate(publicJob(job));
  }

  async submit({ name, input, pseudopotentials = [], study = null }) {
    const status = this.status();
    if (!status.available) throw new Error("Quantum ESPRESSO was not detected in Windows or WSL. Install pw.x in Ubuntu or select a native folder.");
    if (typeof input !== "string" || !input.trim()) throw new Error("Quantum ESPRESSO input is empty.");
    if (input.length > 5_000_000) throw new Error("Quantum ESPRESSO input is larger than the 5 MB safety limit.");
    const nativePseudos = listPseudopotentials(this.pseudoRoot);
    const runtimePseudos = nativePseudos.length ? nativePseudos : this.wslRuntime?.pseudopotentials || [];
    if (!runtimePseudos.length) throw new Error("No .UPF pseudopotentials were found in the selected folder or the WSL SSSP package.");
    const pseudoSource = nativePseudos.length ? "native" : "wsl";
    const byName = new Map(runtimePseudos.map((item) => [item.name.toLowerCase(), item.path]));
    const required = [...new Set(pseudopotentials.map((value) => basename(String(value))))];
    const missing = required.filter((file) => !byName.has(file.toLowerCase()));
    if (missing.length) throw new Error(`Missing pseudopotentials: ${missing.join(", ")}.`);
    const inputHash = createHash("sha256").update(input.replace(/\r\n/g, "\n").trim()).digest("hex");
    const duplicate = [...this.jobs.values()].find((candidate) => ["queued", "running"].includes(candidate.status) && candidate.inputHash === inputHash);
    if (duplicate) return publicJob(duplicate);
    const id = randomUUID();
    const stem = safeJobStem(name, `symviz-qe-${id.slice(0, 8)}`);
    const directory = join(this.workRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${stem}-${id.slice(0, 8)}`);
    const pseudoDirectory = join(directory, "pseudo");
    await mkdir(pseudoDirectory, { recursive: true });
    await mkdir(join(directory, "tmp"), { recursive: true });
    const wslDirectory = status.runtime === "wsl" ? await this.windowsPathToWsl(directory) : null;
    if (pseudoSource === "native") {
      await Promise.all(required.map((file) => copyFile(byName.get(file.toLowerCase()), join(pseudoDirectory, file))));
    } else {
      const destination = `${wslDirectory}/pseudo`;
      for (const file of required) {
        const copied = await this.commandRunner(wslExecutable, [
          "--distribution", this.wslRuntime.distro, "--exec", "/bin/cp", "--",
          byName.get(file.toLowerCase()), `${destination}/${file}`,
        ]);
        if (copied.exitCode !== 0) throw new Error(copied.stderr.trim() || `Could not stage ${file} from WSL.`);
      }
    }
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
      runtime: status.runtime,
      wslDistro: status.wslDistro || null,
      wslPw: status.runtime === "wsl" ? this.wslRuntime.binaries.pw : null,
      wslDirectory,
      directory,
      files: { input: join(directory, `${stem}.in`), output: join(directory, `${stem}.out`) },
      study: normalizedStudyMetadata(study),
    };
    await writeFile(job.files.input, input, "utf8");
    this.jobs.set(id, job);
    await this.emit(job);
    void this.pumpQueue();
    return publicJob(job);
  }

  async windowsPathToWsl(path) {
    if (!this.wslRuntime?.distro) throw new Error("WSL Ubuntu is not connected.");
    const converted = await this.commandRunner(wslExecutable, [
      "--distribution", this.wslRuntime.distro, "--exec", "/usr/bin/wslpath", "-a", "-u", resolve(path),
    ]);
    const linuxPath = converted.stdout.trim();
    if (converted.exitCode !== 0 || !linuxPath.startsWith("/")) {
      throw new Error(converted.stderr.trim() || "Could not convert the Windows task path for WSL.");
    }
    return linuxPath;
  }

  async pumpQueue() {
    if (this.starting || this.children.size > 0) return;
    const next = [...this.jobs.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
    if (!next) return;
    this.starting = true;
    let startupFailed = false;
    try {
      await this.start(next);
    } catch (error) {
      startupFailed = true;
      const message = error instanceof Error ? error.message : String(error || "Unknown WSL startup error.");
      next.status = "failed";
      next.completedAt = new Date().toISOString();
      next.exitCode = null;
      next.error = `Could not start pw.x: ${message}`;
      await writeFile(next.files.output, `[SymViz QE startup error]\n${next.error}\n`, "utf8").catch(() => {});
      await this.emit(next);
    } finally {
      this.starting = false;
    }
    if (startupFailed) void this.pumpQueue();
  }

  async start(job) {
    const nativeBinaries = quantumEspressoBinaries(this.qeRoot);
    const useWsl = job.runtime === "wsl" || (!nativeBinaries.pw && this.wslRuntime?.binaries?.pw);
    if (useWsl && !job.wslDirectory) job.wslDirectory = await this.windowsPathToWsl(job.directory);
    mkdirSync(join(job.directory, "tmp"), { recursive: true });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    void this.emit(job);
    const outputStream = createWriteStream(job.files.output, { flags: "w" });
    const executable = useWsl ? wslExecutable : nativeBinaries.pw;
    const args = useWsl ? wslLaunchArguments({
      distro: job.wslDistro || this.wslRuntime.distro,
      directory: job.wslDirectory,
      pw: job.wslPw || this.wslRuntime.binaries.pw,
    }) : [];
    const child = spawn(executable, args, {
      cwd: job.directory,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.children.set(job.id, child);
    let stderr = "";
    let spawnError = null;
    child.stdout.on("data", (chunk) => outputStream.write(chunk));
    child.stderr.on("data", (chunk) => {
      const decoded = decodeProcessOutput(Buffer.from(chunk));
      stderr += decoded;
      outputStream.write(decoded, "utf8");
    });
    child.once("error", (error) => { spawnError = error; });
    void readFile(job.files.input).then((input) => child.stdin.end(input)).catch((error) => {
      spawnError = error;
      child.stdin.destroy(error);
    });
    child.once("close", async (exitCode, signal) => {
      await new Promise((resolveClose) => outputStream.end(resolveClose));
      job.exitCode = exitCode;
      job.completedAt = new Date().toISOString();
      this.children.delete(job.id);
      if (job.status === "cancelled") {
        await this.emit(job);
        await this.pumpQueue();
        return;
      }
      const output = await readFile(job.files.output, "utf8").catch(() => "");
      job.status = exitCode === 0 && /\bJOB DONE\.\s*$/im.test(output) ? "completed" : "failed";
      if (job.status === "failed") {
        const diagnostic = readableProcessError(stderr);
        const pwStarted = /Program\s+PWSCF\s+v\./i.test(output);
        job.error = spawnError?.message
          || diagnostic
          || (!pwStarted
            ? "pw.x did not start. WSL returned without executing the Quantum ESPRESSO command."
            : `pw.x stopped before JOB DONE (exit code ${exitCode ?? "unknown"}${signal ? `, signal ${signal}` : ""}). Open the output for the final QE message.`);
      } else {
        job.error = null;
      }
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
      let wslStopError = null;
      if (job.runtime === "wsl" && job.wslDistro) {
        try {
          if (!job.wslDirectory) job.wslDirectory = await this.windowsPathToWsl(job.directory);
          const stopped = await this.commandRunner(wslExecutable, wslCancelArguments({
            distro: job.wslDistro,
            directory: job.wslDirectory,
          }), { timeoutMs: 10_000 });
          if (stopped.exitCode !== 0) {
            wslStopError = new Error(readableProcessError(stopped.stderr) || `WSL cancellation exited with code ${stopped.exitCode}.`);
          }
        } catch (error) {
          wslStopError = error;
        }
      }
      const treeTerminated = await terminateProcessTree(child);
      if (!treeTerminated) throw new Error("Windows could not confirm termination of the Quantum ESPRESSO process tree.");
      if (wslStopError) throw new Error(`Could not stop the WSL pw.x process: ${wslStopError instanceof Error ? wslStopError.message : String(wslStopError)}`);
    } else if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = new Date().toISOString();
      await this.emit(job);
      await this.pumpQueue();
    }
    return publicJob(job);
  }

  async output(id) {
    return readFile(this.getJob(id).files.output, "utf8").catch(() => "");
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
}
