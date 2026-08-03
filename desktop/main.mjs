import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GaussianDesktopService } from "./gaussian-service.mjs";
import { QuantumEspressoDesktopService } from "./quantum-espresso-service.mjs";
import { startRendererServer } from "./renderer-server.mjs";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(desktopRoot, "..");
let mainWindow = null;
let rendererServer = null;
let gaussianService = null;
let quantumEspressoService = null;
let rendererOrigin = null;

function trustedSender(event) {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return false;
  try {
    return new URL(event.senderFrame.url).origin === rendererOrigin;
  } catch {
    return false;
  }
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
}

async function createWindow(rendererUrl) {
  rendererOrigin = new URL(rendererUrl).origin;
  mainWindow = new BrowserWindow({
    title: "SymVizCrystal",
    width: 1580,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(desktopRoot, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== rendererOrigin) event.preventDefault();
  });
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
    await gaussianService.initialize();
    await quantumEspressoService.initialize();
    const externalRenderer = process.env.SYMVIZ_RENDERER_URL;
    if (externalRenderer) {
      rendererServer = { url: externalRenderer, close: async () => {} };
    } else {
      rendererServer = await startRendererServer(appRoot);
    }
    registerDesktopHandlers();
    await createWindow(rendererServer.url);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(rendererServer.url);
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
