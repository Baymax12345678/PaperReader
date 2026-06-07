import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const electronApp = join(root, "node_modules", "electron", "dist", "Electron.app");
const outputDir = join(root, "release", "PaperReader-darwin-arm64");
const outputApp = join(outputDir, "PaperReader.app");
const resourcesDir = join(outputApp, "Contents", "Resources");
const appResources = join(resourcesDir, "app");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.quiet ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

await run("ditto", [electronApp, outputApp]);

const plist = join(outputApp, "Contents", "Info.plist");
for (const [key, value] of [
  ["CFBundleDisplayName", "PaperReader"],
  ["CFBundleName", "PaperReader"],
  ["CFBundleIdentifier", "com.paperreader.desktop"],
]) {
  await run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
}

await run("/usr/libexec/PlistBuddy", ["-c", "Delete :CFBundleURLTypes", plist], {
  allowFailure: true,
  quiet: true,
});
await run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleURLTypes array", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleURLTypes:0 dict", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleURLTypes:0:CFBundleURLName string com.paperreader.desktop", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes array", plist]);
await run("/usr/libexec/PlistBuddy", ["-c", "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string paperreader", plist]);

await rm(join(resourcesDir, "default_app.asar"), { force: true });
await rm(appResources, { force: true, recursive: true });
await cp(join(root, ".electron-app"), appResources, { recursive: true });

await run(
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  ["-f", outputApp],
);

console.log(`Packaged ${outputApp}`);
