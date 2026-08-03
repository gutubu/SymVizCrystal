import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GaussianDesktopService,
  detectGaussianRoot,
  gaussianBinaries,
  gaussianProcessEnvironment,
  processTreeKillCommand,
  safeJobStem,
} from "../desktop/gaussian-service.mjs";
import { startRendererServer } from "../desktop/renderer-server.mjs";

test("desktop Gaussian service detects a selected installation and persists an empty queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-desktop-"));
  const gaussianRoot = join(root, "G16W");
  const workRoot = join(root, "jobs");
  await mkdir(gaussianRoot);
  await Promise.all(["g16.exe", "formchk.exe", "cubegen.exe"].map((name) => writeFile(join(gaussianRoot, name), "")));
  try {
    assert.equal(detectGaussianRoot(gaussianRoot), resolve(gaussianRoot));
    assert.equal(gaussianBinaries(gaussianRoot).g16, join(resolve(gaussianRoot), "g16.exe"));
    assert.equal(safeJobStem("A molecule / test.chk"), "A-molecule-test");
    assert.deepEqual(processTreeKillCommand(31415), {
      executable: "taskkill.exe",
      args: ["/PID", "31415", "/T", "/F"],
    });
    const environment = gaussianProcessEnvironment(gaussianRoot, join(workRoot, "scratch"));
    assert.equal(environment.GAUSS_EXEDIR, resolve(gaussianRoot));
    assert.equal(environment.GAUSS_LEXEDIR, resolve(gaussianRoot));
    assert.equal(environment.GAUSS_SCRDIR, resolve(workRoot, "scratch"));
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path");
    assert.ok(pathKey && environment[pathKey].startsWith(`${resolve(gaussianRoot)};`));
    const service = new GaussianDesktopService({ gaussianRoot, workRoot });
    const status = await service.initialize();
    assert.equal(status.desktop, true);
    assert.equal(status.available, true);
    assert.equal(status.binaries.formchk.available, true);
    assert.deepEqual(service.listJobs(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop Gaussian service suppresses duplicate active submissions and reads a bounded live-output tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "symviz-desktop-live-"));
  const gaussianRoot = join(root, "G16W");
  const workRoot = join(root, "jobs");
  await mkdir(gaussianRoot);
  await Promise.all(["g16.exe", "formchk.exe", "cubegen.exe"].map((name) => writeFile(join(gaussianRoot, name), "")));
  try {
    const service = new GaussianDesktopService({ gaussianRoot, workRoot });
    await service.initialize();
    let starts = 0;
    service.start = (job) => {
      starts += 1;
      job.status = "running";
      service.children.set(job.id, { simulated: true });
    };
    const input = "%chk=test-preopt.chk\n#p HF/STO-3G Opt\n\nH2\n\n0 1\nH 0 0 0\nH 0 0 0.74\n\n--Link1--\n%oldchk=test-preopt.chk\n%chk=test-final.chk\n#p HF/6-31G(d) Freq Geom=AllCheck\n\n";
    const first = await service.submit({ name: "H2", input });
    const duplicate = await service.submit({ name: "H2 duplicate click", input: input.replace(/\n/g, "\r\n") });
    assert.equal(duplicate.id, first.id);
    assert.equal(starts, 1);
    assert.equal(service.listJobs().length, 1);

    const job = service.getJob(first.id);
    assert.equal(job.files.checkpoint, join(job.directory, "test-final.chk"));
    const log = `${"old output line\n".repeat(1500)}SCF Done: E(RHF) = -1.117\n`;
    await writeFile(job.files.output, log, "utf8");
    const snapshot = await service.outputTail(first.id, 16_384);
    assert.equal(snapshot.truncated, true);
    assert.ok(snapshot.size > 16_384);
    assert.match(snapshot.text, /SCF Done: E\(RHF\)/);
    assert.ok(snapshot.text.length < log.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop renderer server serves the built SymViz app from a loopback-only URL", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await startRendererServer(root);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /CRYSTAL SYMMETRY EXPLORER/);

    const cssPath = html.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    const scriptPath = html.match(/<script id="_R_">import\("(\/assets\/[^"]+\.js)"\)/)?.[1];
    assert.ok(cssPath, "the desktop HTML should reference a built stylesheet");
    assert.ok(scriptPath, "the desktop HTML should reference a hydration module");

    const cssResponse = await fetch(`${server.url}${cssPath}`);
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get("content-type") || "", /^text\/css/);
    assert.match(await cssResponse.text(), /\.app-shell/);

    const scriptResponse = await fetch(`${server.url}${scriptPath}`);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get("content-type") || "", /javascript/);
    assert.ok((await scriptResponse.text()).length > 1000, "the hydration module should not be empty");
  } finally {
    await server.close();
  }
});
