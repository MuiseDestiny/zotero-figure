import { execSync } from "child_process";
import process from "process";
import cmd from "./zotero-cmd.json" with { type: "json" };
import { stopRunningDevServer } from "./dev-server-lock.mjs";
import { Logger } from "./utils.mjs";

const command =
  process.platform === "win32" ? cmd.killZoteroWindows : cmd.killZoteroUnix;
if (!command) {
  throw new Error(`No stop command configured for ${process.platform}`);
}

const stoppedDevServer = await stopRunningDevServer();
if (stoppedDevServer) Logger.info("Stopped development server");

try {
  execSync(command, { stdio: "ignore" });
  Logger.info("Stopped Zotero");
} catch {
  if (!stoppedDevServer) {
    Logger.warn("Zotero is not running or could not be stopped");
  }
}
