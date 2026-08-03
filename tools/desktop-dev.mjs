import { spawn } from "node:child_process";
import electronPath from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererUrl = process.env.SYMVIZ_RENDERER_URL || "http://127.0.0.1:3000";
const vinextCli = join(root, "node_modules", "vinext", "dist", "cli.js");
const electronMain = join(root, "desktop", "main.mjs");

function stopTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForRenderer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The renderer is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const renderer = spawn(process.execPath, [vinextCli, "dev", "--host", "127.0.0.1", "--port", "3000"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
let desktop;
try {
  await waitForRenderer(rendererUrl);
  desktop = spawn(electronPath, [electronMain], {
    cwd: root,
    env: { ...process.env, SYMVIZ_RENDERER_URL: rendererUrl },
    stdio: "inherit",
    windowsHide: false,
  });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    desktop.once("error", rejectExit);
    desktop.once("exit", (code) => resolveExit(code ?? 0));
  });
  process.exitCode = exitCode;
} finally {
  stopTree(desktop);
  stopTree(renderer);
}
