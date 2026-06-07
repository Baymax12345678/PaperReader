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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);
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
