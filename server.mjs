import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePaperApi } from "./dist-server/paperApi.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
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
}).listen(port, () => {
  console.log(`PaperReader is running at http://localhost:${port}`);
});
