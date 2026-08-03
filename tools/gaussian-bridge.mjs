import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.SYMVIZ_GAUSSIAN_PORT || 8765);
const gaussianRoot = resolve(process.env.SYMVIZ_GAUSSIAN_ROOT || "C:\\G16W");
const workRoot = resolve(process.env.SYMVIZ_GAUSSIAN_WORKDIR || join(process.cwd(), "gaussian-jobs"));
const token = process.env.SYMVIZ_GAUSSIAN_TOKEN || randomBytes(18).toString("base64url");
const binaries = {
  g16: join(gaussianRoot, "g16.exe"),
  formchk: join(gaussianRoot, "formchk.exe"),
  cubegen: join(gaussianRoot, "cubegen.exe"),
};
const jobs = new Map();

await mkdir(workRoot, { recursive: true });

function allowedOrigin(origin) {
  if (!origin) return true;
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
    || /^https:\/\/symviz-crystal(?:[.-][a-z0-9-]+)*\.chatgpt\.site$/i.test(origin);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "access-control-allow-origin": allowedOrigin(origin) && origin ? origin : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-symviz-token",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

function json(request, status, value) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });
}

function text(request, status, value, contentType = "text/plain; charset=utf-8") {
  return new Response(value, {
    status,
    headers: { "content-type": contentType, ...corsHeaders(request) },
  });
}

function authorized(request) {
  return request.headers.get("x-symviz-token") === token;
}

async function readJson(request, limit = 2_000_000) {
  const body = await request.text();
  if (body.length > limit) throw new Error("Request body is too large.");
  return body ? JSON.parse(body) : {};
}

function safeStem(value, fallback = "symviz-job") {
  const normalized = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
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
    signal: job.signal,
    error: job.error,
    files: job.files,
  };
}

async function runProcess(executable, args, options = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      cwd: options.cwd,
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

async function startGaussianJob(job) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  const child = spawn(binaries.g16, [job.files.input, job.files.output], {
    windowsHide: true,
    cwd: job.directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", (error) => {
    job.status = "failed";
    job.error = error.message;
    job.completedAt = new Date().toISOString();
  });
  child.once("close", async (exitCode, signal) => {
    job.exitCode = exitCode;
    job.signal = signal;
    job.completedAt = new Date().toISOString();
    job.child = null;
    let output = "";
    try {
      output = await readFile(job.files.output, "utf8");
    } catch {
      // Gaussian may fail before creating its output file.
    }
    job.status = exitCode === 0 && /Normal termination of Gaussian/i.test(output)
      ? "completed"
      : job.status === "cancelled" ? "cancelled" : "failed";
    if (job.status === "failed" && !job.error) {
      job.error = stderr.trim() || "Gaussian did not report a normal termination.";
    }
  });
}

async function ensureFormattedCheckpoint(job) {
  if (!existsSync(job.files.checkpoint)) throw new Error("The Gaussian checkpoint file is not available.");
  const result = await runProcess(binaries.formchk, [job.files.checkpoint, job.files.formattedCheckpoint], { cwd: job.directory });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "formchk failed.");
  return job.files.formattedCheckpoint;
}

async function generateCube(job, property) {
  await ensureFormattedCheckpoint(job);
  const allowedProperties = new Map([
    ["density", "Density=SCF"],
    ["esp", "Potential=SCF"],
    ["homo", "MO=Homo"],
    ["lumo", "MO=Lumo"],
  ]);
  const cubeProperty = allowedProperties.get(property);
  if (!cubeProperty) throw new Error("Unsupported Cube property.");
  const cubePath = join(job.directory, `${safeStem(job.name)}-${property}.cube`);
  const result = await runProcess(
    binaries.cubegen,
    ["0", cubeProperty, job.files.formattedCheckpoint, cubePath, "-2", "h"],
    { cwd: job.directory },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "cubegen failed.");
  job.files[`${property}Cube`] = cubePath;
  return cubePath;
}

const server = createServer(async (nodeRequest, nodeResponse) => {
  const request = new Request(`http://${host}:${port}${nodeRequest.url}`, {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body: ["GET", "HEAD"].includes(nodeRequest.method || "GET") ? undefined : nodeRequest,
    duplex: "half",
  });
  let response;
  try {
    if (!allowedOrigin(request.headers.get("origin"))) {
      response = json(request, 403, { error: "Origin is not allowed." });
    } else if (request.method === "OPTIONS") {
      response = new Response(null, { status: 204, headers: corsHeaders(request) });
    } else {
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      if (request.method === "GET" && url.pathname === "/health") {
        response = json(request, 200, {
          name: "SymViz Gaussian Bridge",
          version: "0.1.2",
          gaussianRoot,
          workRoot,
          tokenRequired: true,
          binaries: Object.fromEntries(Object.entries(binaries).map(([name, path]) => [name, {
            path,
            available: existsSync(path),
          }])),
        });
      } else if (!authorized(request)) {
        response = json(request, 401, { error: "A valid x-symviz-token header is required." });
      } else if (request.method === "GET" && url.pathname === "/jobs") {
        response = json(request, 200, { jobs: [...jobs.values()].map(publicJob) });
      } else if (request.method === "POST" && url.pathname === "/jobs") {
        if (!existsSync(binaries.g16)) throw new Error(`Gaussian executable not found: ${binaries.g16}`);
        const body = await readJson(request);
        if (typeof body.input !== "string" || !body.input.trim()) throw new Error("Gaussian input is required.");
        const id = randomUUID();
        const name = safeStem(body.name, `symviz-${id.slice(0, 8)}`);
        const directory = join(workRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}-${id.slice(0, 8)}`);
        await mkdir(directory, { recursive: true });
        const checkpointMatches = [...body.input.matchAll(/^\s*%chk\s*=\s*(.+)$/gim)];
        const checkpointName = safeStem(checkpointMatches.at(-1)?.[1]?.trim() || name) + ".chk";
        const job = {
          id,
          name,
          status: "queued",
          submittedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          exitCode: null,
          signal: null,
          error: null,
          child: null,
          directory,
          files: {
            input: join(directory, `${name}.gjf`),
            output: join(directory, `${name}.log`),
            checkpoint: join(directory, checkpointName),
            formattedCheckpoint: join(directory, `${name}.fchk`),
          },
        };
        await writeFile(job.files.input, body.input, "utf8");
        jobs.set(id, job);
        void startGaussianJob(job);
        response = json(request, 202, { job: publicJob(job) });
      } else if (parts[0] === "jobs" && parts[1] && jobs.has(parts[1])) {
        const job = jobs.get(parts[1]);
        if (request.method === "GET" && parts[2] === "output") {
          const output = await readFile(job.files.output, "utf8").catch(() => "");
          response = text(request, 200, output);
        } else if (request.method === "GET" && parts[2] === "cube" && parts[3]) {
          const property = String(parts[3]).toLowerCase();
          const cubePath = job.files[`${property}Cube`];
          if (!cubePath || !existsSync(cubePath)) throw new Error(`The ${property} Cube file has not been generated.`);
          response = text(request, 200, await readFile(cubePath, "utf8"), "text/plain; charset=utf-8");
        } else if (request.method === "POST" && parts[2] === "cancel") {
          if (job.child && job.status === "running") {
            job.status = "cancelled";
            job.child.kill();
          }
          response = json(request, 200, { job: publicJob(job) });
        } else if (request.method === "POST" && parts[2] === "formchk") {
          const path = await ensureFormattedCheckpoint(job);
          response = json(request, 200, { path });
        } else if (request.method === "POST" && parts[2] === "cube") {
          const body = await readJson(request);
          const property = String(body.property || "density").toLowerCase();
          const path = await generateCube(job, property);
          response = json(request, 200, {
            path,
            fileName: basename(path),
            downloadUrl: `/jobs/${job.id}/cube/${property}`,
          });
        } else {
          response = json(request, 200, { job: publicJob(job) });
        }
      } else {
        response = json(request, 404, { error: "Not found." });
      }
    }
  } catch (error) {
    response = json(request, 400, { error: error instanceof Error ? error.message : String(error) });
  }
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, host, () => {
  console.log(`SymViz Gaussian Bridge v0.1.2`);
  console.log(`Listening on http://${host}:${port}`);
  console.log(`Gaussian root: ${gaussianRoot}`);
  console.log(`Working directory: ${workRoot}`);
  console.log(`Access token: ${token}`);
  console.log("Keep this terminal open while SymViz submits or monitors Gaussian jobs.");
});
