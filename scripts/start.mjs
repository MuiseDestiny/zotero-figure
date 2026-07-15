import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import details from "../package.json" with { type: "json" };
import cmd from "./zotero-cmd.json" with { type: "json" };
import { Logger } from "./utils.mjs";

const { addonID } = details.config;
const { dataDir, profilePath, zoteroBinPath } = cmd.exec;
const readyMarker = `Plugin ${addonID} startup`;
const logDirectory = "logs";
const logFile = path.join(logDirectory, "zotero.log");

export function main(onReady = () => {}) {
  validateConfiguration();
  prepareDevelopmentProfile();
  mkdirSync(logDirectory, { recursive: true });
  writeFileSync(logFile, "");

  let ready = false;
  const child = spawn(zoteroBinPath, [
    "--jsdebugger",
    "--purgecaches",
    "-profile",
    profilePath,
  ]);
  child.once("error", (error) => Logger.error("Failed to start Zotero", error));
  child.stdout.on("data", (data) => {
    appendLog(data);
    if (!ready && data.toString().includes(readyMarker)) {
      ready = true;
      onReady();
    }
  });
  child.stderr.on("data", appendLog);
  return child;
}

function validateConfiguration() {
  const requiredPaths = [
    ["Zotero binary", zoteroBinPath],
    ["Zotero profile", profilePath],
    ["development build", path.resolve("build/addon/manifest.json")],
  ];
  for (const [label, value] of requiredPaths) {
    if (!existsSync(value))
      throw new Error(`${label} does not exist: ${value}`);
  }
}

function prepareDevelopmentProfile() {
  const extensionsDirectory = path.join(profilePath, "extensions");
  mkdirSync(extensionsDirectory, { recursive: true });
  const proxyFile = path.join(extensionsDirectory, addonID);
  const buildPath = path.resolve("build/addon");
  if (!existsSync(proxyFile) || readFileSync(proxyFile, "utf8") !== buildPath) {
    writeFileSync(proxyFile, buildPath);
    Logger.debug(`Updated add-on proxy: ${proxyFile} -> ${buildPath}`);
  }

  const installedXPI = path.join(extensionsDirectory, `${addonID}.xpi`);
  rmSync(installedXPI, { force: true });
  updateProfilePreferences();
}

function updateProfilePreferences() {
  const prefsFile = path.join(profilePath, "prefs.js");
  if (!existsSync(prefsFile)) return;

  const lines = readFileSync(prefsFile, "utf8")
    .split("\n")
    .filter(
      (line) =>
        !line.includes("extensions.lastAppBuildId") &&
        !line.includes("extensions.lastAppVersion"),
    )
    .map((line) => {
      if (line.includes("extensions.zotero.dataDir") && dataDir) {
        return `user_pref("extensions.zotero.dataDir", ${JSON.stringify(dataDir)});`;
      }
      return line;
    });
  writeFileSync(prefsFile, lines.join("\n"), "utf8");
}

function appendLog(data) {
  writeFileSync(logFile, data, { flag: "a" });
}
