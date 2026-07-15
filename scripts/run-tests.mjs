import { spawn } from "child_process";
import { build } from "esbuild";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const sourceDirectory = "tests";
const outputDirectory = mkdtempSync(
  path.join(tmpdir(), "zotero-figure-tests-"),
);

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(entryPath);
    return entry.name.endsWith(".test.ts") ? [entryPath] : [];
  });
}

const testFiles = findTests(sourceDirectory);
if (testFiles.length === 0) throw new Error("No test files found");

try {
  await build({
    bundle: true,
    entryPoints: testFiles,
    format: "cjs",
    outbase: sourceDirectory,
    outdir: outputDirectory,
    packages: "external",
    platform: "node",
    sourcemap: "inline",
    target: "node20",
  });

  const compiledTests = testFiles.map((file) =>
    path.join(
      outputDirectory,
      path.relative(sourceDirectory, file).replace(/\.ts$/, ".js"),
    ),
  );
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...compiledTests], {
      env: { ...process.env, NODE_PATH: path.resolve("node_modules") },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  rmSync(outputDirectory, { force: true, recursive: true });
}
