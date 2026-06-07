import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const target = join(root, ".electron-app");

await rm(target, { force: true, recursive: true });
await mkdir(target, { recursive: true });

await Promise.all([
  cp(join(root, "dist"), join(target, "dist"), { recursive: true }),
  cp(join(root, "dist-server"), join(target, "dist-server"), { recursive: true }),
  cp(join(root, "electron"), join(target, "electron"), { recursive: true }),
]);

await writeFile(
  join(target, "package.json"),
  JSON.stringify(
    {
      name: "paper-reader",
      version: "0.1.0",
      private: true,
      type: "module",
      main: "electron/main.cjs",
    },
    null,
    2,
  ),
);
