import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const electronApp = join(root, "node_modules", "electron", "dist", "Electron.app");
const outputDir = join(root, "release", "PaperReader-darwin-arm64");
const outputApp = join(outputDir, "PaperReader.app");
const resourcesDir = join(outputApp, "Contents", "Resources");
const appResources = join(resourcesDir, "app");

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

await new Promise((resolve, reject) => {
  const child = spawn("ditto", [electronApp, outputApp], { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`ditto exited with code ${code}`));
    }
  });
});

const plist = join(outputApp, "Contents", "Info.plist");
for (const [key, value] of [
  ["CFBundleDisplayName", "PaperReader"],
  ["CFBundleName", "PaperReader"],
  ["CFBundleIdentifier", "com.paperreader.desktop"],
]) {
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PlistBuddy exited with code ${code}`));
      }
    });
  });
}

await rm(join(resourcesDir, "default_app.asar"), { force: true });
await rm(appResources, { force: true, recursive: true });
await cp(join(root, ".electron-app"), appResources, { recursive: true });

console.log(`Packaged ${outputApp}`);
