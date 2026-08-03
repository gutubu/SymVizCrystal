import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeAssetPath(clientRoot, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolved = resolve(clientRoot, normalize(decoded));
  return resolved === clientRoot || resolved.startsWith(`${clientRoot}\\`) ? resolved : null;
}

async function assetResponse(clientRoot, request) {
  const url = new URL(request.url);
  const path = safeAssetPath(clientRoot, url.pathname);
  if (!path) return new Response("Forbidden", { status: 403 });
  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    return new Response(await readFile(path), {
      status: 200,
      headers: {
        "content-type": mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
        "cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function sendNodeResponse(nodeResponse, response, method = "GET") {
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
  if (method === "HEAD") {
    nodeResponse.end();
    return;
  }
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

export async function startRendererServer(appRoot) {
  const root = resolve(appRoot);
  const clientRoot = join(root, "dist", "client");
  const workerPath = join(root, "dist", "server", "index.js");
  const workerModule = await import(`${pathToFileURL(workerPath).href}?desktop=${Date.now()}`);
  const worker = workerModule.default;
  if (!worker?.fetch) throw new Error("The built SymViz renderer is missing. Run the web build first.");

  const server = createServer(async (nodeRequest, nodeResponse) => {
    try {
      const origin = `http://127.0.0.1:${server.address()?.port ?? 0}`;
      const requestUrl = new URL(nodeRequest.url || "/", origin);
      const request = new Request(requestUrl, {
        method: nodeRequest.method,
        headers: nodeRequest.headers,
        body: ["GET", "HEAD"].includes(nodeRequest.method || "GET") ? undefined : nodeRequest,
        duplex: "half",
      });

      // The Vinext worker delegates public files to an ASSETS binding in the
      // hosting runtime. Electron does not provide that binding natively, so
      // serve matching build files before handing application routes to the
      // worker. Without this branch the HTML renders, but its CSS and client
      // modules return 404 and React never hydrates.
      if (["GET", "HEAD"].includes(nodeRequest.method || "GET")) {
        const directAsset = await assetResponse(clientRoot, request);
        if (directAsset.status !== 404) {
          await sendNodeResponse(nodeResponse, directAsset, nodeRequest.method);
          return;
        }
      }

      const response = await worker.fetch(
        request,
        { ASSETS: { fetch: (assetRequest) => assetResponse(clientRoot, assetRequest) } },
        { waitUntil() {}, passThroughOnException() {} },
      );
      await sendNodeResponse(nodeResponse, response, nodeRequest.method);
    } catch (error) {
      nodeResponse.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      nodeResponse.end(error instanceof Error ? error.stack || error.message : String(error));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the SymViz desktop renderer.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}
