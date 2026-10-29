import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GaussianDesktopService } from "./gaussian-service.mjs";
import { MultiwfnDesktopService, validateMultiwfnInput } from "./multiwfn-service.mjs";
import { QuantumEspressoDesktopService } from "./quantum-espresso-service.mjs";
import { startRendererServer } from "./renderer-server.mjs";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(desktopRoot, "..");
let mainWindow = null;
let rendererServer = null;
let gaussianService = null;
let quantumEspressoService = null;
let multiwfnService = null;
let rendererOrigin = null;
const appWindows = new Set();

function trustedSender(event) {
  if (![...appWindows].some((window) => !window.isDestroyed() && event.sender.id === window.webContents.id)) return false;
  try {
    return new URL(event.senderFrame.url).origin === rendererOrigin;
  } catch {
    return false;
  }
}

function secureWindowOptions(overrides = {}) {
  return {
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(desktopRoot, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    ...overrides,
  };
}

function protectWindowNavigation(window) {
  appWindows.add(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== rendererOrigin) event.preventDefault();
  });
  window.on("closed", () => appWindows.delete(window));
}

async function openMultiwfnVisualizer(jobId = "", artifactName = "") {
  const params = new URLSearchParams();
  if (jobId) params.set("job", String(jobId));
  if (artifactName) params.set("file", String(artifactName));
  const viewerUrl = new URL(`/multiwfn-visualizer${params.size ? `?${params}` : ""}`, rendererServer.url).href;
  const viewer = new BrowserWindow(secureWindowOptions({
    title: "SymViz · Multiwfn 3D Visualizer",
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    show: false,
  }));
  protectWindowNavigation(viewer);
  viewer.once("ready-to-show", () => viewer.show());
  await viewer.loadURL(viewerUrl);
  return true;
}

function desktopHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) throw new Error("Untrusted desktop request.");
    return handler(...args);
  });
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(join(app.getPath("userData"), "desktop-config.json"), "utf8"));
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  const current = await readConfig();
  await writeFile(join(app.getPath("userData"), "desktop-config.json"), JSON.stringify({ ...current, ...config }, null, 2), "utf8");
}

function registerDesktopHandlers() {
  desktopHandler("symviz:desktop-status", () => gaussianService.status());
  desktopHandler("symviz:list-gaussian-jobs", () => gaussianService.listJobs());
  desktopHandler("symviz:submit-gaussian-job", (payload) => gaussianService.submit({
    name: String(payload?.name || "symviz-job"),
    input: String(payload?.input || ""),
  }));
  desktopHandler("symviz:cancel-gaussian-job", (id) => gaussianService.cancel(String(id)));
  desktopHandler("symviz:get-gaussian-output", (id) => gaussianService.output(String(id)));
  desktopHandler("symviz:get-gaussian-output-tail", (id, maxBytes) => gaussianService.outputTail(String(id), Number(maxBytes)));
  desktopHandler("symviz:generate-gaussian-cube", (id, property) => gaussianService.generateCube(String(id), String(property)));
  desktopHandler("symviz:read-gaussian-cube", (id, property) => gaussianService.readCube(String(id), String(property)));
  desktopHandler("symviz:reveal-gaussian-job", (id) => {
    const job = gaussianService.getJob(String(id));
    shell.showItemInFolder(existsSync(job.files.output) ? job.files.output : job.files.input);
    return true;
  });
  desktopHandler("symviz:choose-gaussian-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择包含 g16.exe 的 Gaussian 16 文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return gaussianService.status();
    const status = gaussianService.setGaussianRoot(result.filePaths[0]);
    await saveConfig({ gaussianRoot: status.gaussianRoot });
    return status;
  });
  desktopHandler("symviz:qe-status", () => quantumEspressoService.refreshRuntime());
  desktopHandler("symviz:list-qe-jobs", () => quantumEspressoService.listJobs());
  desktopHandler("symviz:submit-qe-job", (payload) => quantumEspressoService.submit({
    name: String(payload?.name || "symviz-qe"),
    input: String(payload?.input || ""),
    pseudopotentials: Array.isArray(payload?.pseudopotentials) ? payload.pseudopotentials.map(String) : [],
    study: payload?.study && typeof payload.study === "object" ? payload.study : null,
  }));
  desktopHandler("symviz:cancel-qe-job", (id) => quantumEspressoService.cancel(String(id)));
  desktopHandler("symviz:get-qe-output", (id) => quantumEspressoService.output(String(id)));
  desktopHandler("symviz:get-qe-output-tail", (id, maxBytes) => quantumEspressoService.outputTail(String(id), Number(maxBytes)));
  desktopHandler("symviz:reveal-qe-job", (id) => {
    const job = quantumEspressoService.getJob(String(id));
    shell.showItemInFolder(existsSync(job.files.output) ? job.files.output : job.files.input);
    return true;
  });
  desktopHandler("symviz:choose-qe-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择包含 pw.exe / pw.x 的 Quantum ESPRESSO 文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return quantumEspressoService.status();
    const status = quantumEspressoService.setQeRoot(result.filePaths[0]);
    await saveConfig({ qeRoot: status.qeRoot });
    return status;
  });
  desktopHandler("symviz:choose-qe-pseudo-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择包含 .UPF 文件的赝势文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return quantumEspressoService.status();
    const status = quantumEspressoService.setPseudoRoot(result.filePaths[0]);
    await saveConfig({ qePseudoRoot: status.pseudoRoot });
    return status;
  });
  desktopHandler("symviz:multiwfn-status", () => multiwfnService.status());
  desktopHandler("symviz:list-multiwfn-jobs", () => multiwfnService.listJobs());
  desktopHandler("symviz:choose-multiwfn-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择包含 Multiwfn.exe 的文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return multiwfnService.status();
    const status = multiwfnService.setMultiwfnRoot(result.filePaths[0]);
    await saveConfig({ multiwfnRoot: status.multiwfnRoot });
    return status;
  });
  desktopHandler("symviz:choose-multiwfn-input", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Multiwfn 输入文件",
      properties: ["openFile"],
      filters: [
        { name: "Wavefunction and structure files", extensions: ["chk", "fch", "fchk", "wfn", "wfx", "mwfn", "molden", "mol", "mol2", "pdb", "xyz", "gjf", "com", "log", "out", "cube", "cub"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = validateMultiwfnInput(result.filePaths[0]);
    return { path, name: path.split(/[\\/]/).at(-1) };
  });
  desktopHandler("symviz:submit-multiwfn-job", (payload) => multiwfnService.submit({
    name: String(payload?.name || "multiwfn-job"),
    inputPath: String(payload?.inputPath || ""),
    taskId: String(payload?.taskId || "summary"),
    script: String(payload?.script || ""),
  }));
  desktopHandler("symviz:cancel-multiwfn-job", (id) => multiwfnService.cancel(String(id)));
  desktopHandler("symviz:get-multiwfn-output", (id) => multiwfnService.output(String(id)));
  desktopHandler("symviz:get-multiwfn-output-tail", (id, maxBytes) => multiwfnService.outputTail(String(id), Number(maxBytes)));
  desktopHandler("symviz:read-multiwfn-artifact", (id, name) => multiwfnService.readArtifact(String(id), String(name)));
  desktopHandler("symviz:reveal-multiwfn-job", (id) => {
    const job = multiwfnService.getJob(String(id));
    shell.showItemInFolder(existsSync(job.files.output) ? job.files.output : job.files.input);
    return true;
  });
  desktopHandler("symviz:open-multiwfn-visualizer", (id, name) => openMultiwfnVisualizer(String(id || ""), String(name || "")));
}

async function createWindow(rendererUrl) {
  rendererOrigin = new URL(rendererUrl).origin;
  mainWindow = new BrowserWindow(secureWindowOptions({
    title: "SymVizCrystal",
    width: 1580,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    show: false,
  }));
  protectWindowNavigation(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(rendererUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const config = await readConfig();
    gaussianService = new GaussianDesktopService({
      workRoot: join(app.getPath("documents"), "SymViz Gaussian Jobs"),
      gaussianRoot: config.gaussianRoot,
      onUpdate: (job) => mainWindow?.webContents.send("symviz:gaussian-event", job),
    });
    quantumEspressoService = new QuantumEspressoDesktopService({
      workRoot: join(app.getPath("documents"), "SymViz Quantum ESPRESSO Jobs"),
      qeRoot: config.qeRoot,
      pseudoRoot: config.qePseudoRoot,
      wslDistro: config.qeWslDistro || "Ubuntu",
      onUpdate: (job) => mainWindow?.webContents.send("symviz:qe-event", job),
    });
    multiwfnService = new MultiwfnDesktopService({
      workRoot: join(app.getPath("documents"), "SymViz Multiwfn Jobs"),
      multiwfnRoot: config.multiwfnRoot,
      searchRoots: [appRoot, dirname(appRoot)],
      onUpdate: (job) => {
        for (const window of appWindows) {
          if (!window.isDestroyed()) window.webContents.send("symviz:multiwfn-event", job);
        }
      },
    });
    await gaussianService.initialize();
    await quantumEspressoService.initialize();
    await multiwfnService.initialize();
    const externalRenderer = process.env.SYMVIZ_RENDERER_URL;
    if (externalRenderer) {
      rendererServer = { url: externalRenderer, close: async () => {} };
    } else {
      rendererServer = await startRendererServer(appRoot);
    }
    registerDesktopHandlers();
    await createWindow(rendererServer.url);
    app.on("activate", () => {
      if (!mainWindow) void createWindow(rendererServer.url);
    });
  }).catch((error) => {
    dialog.showErrorBox("SymVizCrystal could not start", error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void rendererServer?.close();
});
