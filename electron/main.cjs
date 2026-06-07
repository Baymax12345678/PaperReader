const { app, BrowserWindow, shell } = require("electron");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { createServer } = require("node:http");
const { extname, join, normalize } = require("node:path");
const { pathToFileURL } = require("node:url");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

let localServer;
let mainWindow;
let appUrl;
let pendingAuthCallbackUrl;

const protocolScheme = "paperreader";

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [process.argv[1]]);
    }
    return;
  }
  app.setAsDefaultProtocolClient(protocolScheme);
}

function toAppAuthUrl(callbackUrl) {
  if (!appUrl) return null;
  const url = new URL(callbackUrl);
  const target = new URL(appUrl);
  target.search = url.search;
  target.hash = url.hash;
  return target.toString();
}

async function handleAuthCallback(callbackUrl) {
  if (!appUrl) {
    pendingAuthCallbackUrl = callbackUrl;
    return;
  }

  const targetUrl = toAppAuthUrl(callbackUrl);
  if (!targetUrl) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow(targetUrl);
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  await mainWindow.loadURL(targetUrl);
}

async function startLocalServer() {
  const root = app.getAppPath();
  const dist = join(root, "dist");
  const { handlePaperApi } = await import(pathToFileURL(join(root, "dist-server", "paperApi.js")).href);

  localServer = createServer(async (request, response) => {
    if (await handlePaperApi(request, response)) return;

    const url = new URL(request.url || "/", "http://localhost");
    const requestedPath = normalize(decodeURIComponent(url.pathname));
    const filePath = join(dist, requestedPath === "/" ? "index.html" : requestedPath);

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(200, { "content-type": mimeTypes[".html"] });
      createReadStream(join(dist, "index.html")).pipe(response);
    }
  });

  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", resolve);
  });

  const address = localServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start PaperReader local server.");
  }
  return `http://127.0.0.1:${address.port}/`;
}

async function createWindow(initialUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: "PaperReader",
    backgroundColor: "#f7f7f5",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  appUrl = isDev ? process.env.ELECTRON_RENDERER_URL || "http://localhost:5173/" : await startLocalServer();
  await mainWindow.loadURL(initialUrl || appUrl);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const callbackUrl = argv.find((item) => item.startsWith(`${protocolScheme}://`));
    if (callbackUrl) {
      void handleAuthCallback(callbackUrl);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, callbackUrl) => {
    event.preventDefault();
    void handleAuthCallback(callbackUrl);
  });

  app.whenReady().then(() => {
    registerProtocolClient();
    const launchCallbackUrl = process.argv.find((item) => item.startsWith(`${protocolScheme}://`));
    if (launchCallbackUrl) pendingAuthCallbackUrl = launchCallbackUrl;

    return createWindow().then(() => {
      if (pendingAuthCallbackUrl) {
        const callbackUrl = pendingAuthCallbackUrl;
        pendingAuthCallbackUrl = undefined;
        return handleAuthCallback(callbackUrl);
      }
      return undefined;
    });
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  localServer?.close();
});
