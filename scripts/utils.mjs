import {
  copyFileSync as copyFile,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "fs";
import path from "path";

export function copyFileSync(source, target) {
  const targetFile =
    existsSync(target) && lstatSync(target).isDirectory()
      ? path.join(target, path.basename(source))
      : target;
  mkdirSync(path.dirname(targetFile), { recursive: true });
  copyFile(source, targetFile);
}

export function copyFolderRecursiveSync(source, target, options = {}) {
  const targetFolder = path.join(target, path.basename(source));
  mkdirSync(target, { recursive: true });
  cpSync(source, targetFolder, { recursive: true, ...options });
}

export function clearFolder(target) {
  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
}

export function dateFormat(format, date) {
  const values = {
    YYYY: String(date.getFullYear()),
    dd: String(date.getDate()).padStart(2, "0"),
    mm: String(date.getMonth() + 1).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    MM: String(date.getMinutes()).padStart(2, "0"),
    SS: String(date.getSeconds()).padStart(2, "0"),
  };
  return Object.entries(values).reduce(
    (result, [token, value]) => result.replace(token, value),
    format,
  );
}

export class Logger {
  static error(...values) {
    console.error("\u001b[31m[ERROR]", ...values, "\u001b[0m");
  }

  static warn(...values) {
    console.warn("\u001b[33m[WARN]", ...values, "\u001b[0m");
  }

  static debug(...values) {
    console.log("\u001b[34m[DEBUG]\u001b[0m", ...values);
  }

  static info(...values) {
    console.log("\u001b[32m[INFO]", ...values, "\u001b[0m");
  }
}
