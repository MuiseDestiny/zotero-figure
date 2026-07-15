import { spawnSync } from "child_process";
import { readdirSync } from "fs";
import path from "path";

const files = [
  ...readdirSync("scripts")
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => path.join("scripts", file)),
  "addon/bootstrap.js",
  "addon/chrome/content/yolo-worker.js",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`Syntax check failed: ${file}`);
  }
}

console.log(`Script syntax check passed (${files.length} files)`);
