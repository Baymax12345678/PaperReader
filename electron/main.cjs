const { app, BrowserWindow, shell } = require("electron");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { createServer } = require("node:http");
const { extname, join, normalize } = require("node:path");
const { pathToFileURL } = require("node:url");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const preferredPort = 17654;

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

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function listenOnStablePort(server) {
  for (let port = preferredPort; port < preferredPort + 10; port += 1) {
    try {
      await listen(server, port);
      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`Unable to start PaperReader local server on ports ${preferredPort}-${preferredPort + 9}.`);
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

  const port = await listenOnStablePort(localServer);
  return `http://127.0.0.1:${port}/`;
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
