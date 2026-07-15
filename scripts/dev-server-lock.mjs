import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import path from "path";

export const DEV_SERVER_PID_FILE = path.resolve("logs/dev-server.pid");

export function acquireDevServerLock() {
  mkdirSync(path.dirname(DEV_SERVER_PID_FILE), { recursive: true });
  const runningPID = getRunningDevServerPID();
  if (runningPID) {
    throw new Error(
      `Development server is already running with PID ${runningPID}. Run npm run restart instead.`,
    );
  }

  let descriptor;
  try {
    descriptor = openSync(DEV_SERVER_PID_FILE, "wx");
    writeFileSync(descriptor, String(process.pid));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  return () => {
    if (readPIDFile() === process.pid) {
      rmSync(DEV_SERVER_PID_FILE, { force: true });
    }
  };
}

export function getRunningDevServerPID() {
  const pid = readPIDFile();
  if (!pid) {
    rmSync(DEV_SERVER_PID_FILE, { force: true });
    return undefined;
  }
  if (isProcessRunning(pid)) return pid;
  rmSync(DEV_SERVER_PID_FILE, { force: true });
  return undefined;
}

export async function stopRunningDevServer(timeoutMs = 5_000) {
  const pid = getRunningDevServerPID();
  if (!pid || pid === process.pid) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isProcessRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (isProcessRunning(pid)) process.kill(pid, "SIGKILL");
  rmSync(DEV_SERVER_PID_FILE, { force: true });
  return true;
}

function readPIDFile() {
  if (!existsSync(DEV_SERVER_PID_FILE)) return undefined;
  const pid = Number(readFileSync(DEV_SERVER_PID_FILE, "utf8").trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
