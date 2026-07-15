import { spawnSync } from "child_process";
import chokidar from "chokidar";
import { context } from "esbuild";
import cmd from "./zotero-cmd.json" with { type: "json" };
import { main as build, esbuildOptions } from "./build.mjs";
import { acquireDevServerLock } from "./dev-server-lock.mjs";
import { openDevToolScript, reloadScript } from "./scripts.mjs";
import { main as startZotero } from "./start.mjs";
import { Logger } from "./utils.mjs";

process.env.NODE_ENV = "development";

const { profilePath, zoteroBinPath } = cmd.exec;
const watchedPaths = ["src/**", "addon/**"];
const rebuildEvents = new Set(["add", "change", "unlink"]);
const REBUILD_DEBOUNCE_MS = 150;

async function watch() {
  const buildContext = await context(esbuildOptions);
  const watcher = chokidar.watch(watchedPaths, {
    ignored: [
      /(^|[\/\\])\../,
      "addon/chrome/content/mupdf/**",
      "addon/chrome/content/transformers/**",
    ],
    ignoreInitial: true,
    persistent: true,
  });
  const pendingFiles = new Set();
  let rebuildTimer;
  let updateChain = Promise.resolve();

  watcher.on("ready", () => Logger.info("Development watcher ready"));
  watcher.on("all", (event, file) => {
    if (!rebuildEvents.has(event)) return;
    pendingFiles.add(file);
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      const files = [...pendingFiles];
      pendingFiles.clear();
      updateChain = updateChain
        .then(() => rebuild(files, buildContext))
        .catch((error) => Logger.error("Rebuild failed", error));
    }, REBUILD_DEBOUNCE_MS);
  });
  watcher.on("error", (error) => Logger.error("Watcher failed", error));
  return {
    async close() {
      clearTimeout(rebuildTimer);
      pendingFiles.clear();
      await watcher.close();
      await updateChain;
      await buildContext.dispose();
    },
  };
}

async function rebuild(files, buildContext) {
  const description =
    files.length === 1 ? files[0] : `${files.length} source files`;
  Logger.info(`${description} changed`);
  if (files.every((file) => /^src[\/\\]/.test(file))) {
    await buildContext.rebuild();
  } else await build();
  openZoteroURL(reloadScript, "Reloading plugin");
}

function openZoteroURL(script, action) {
  Logger.debug(action);
  const url = `zotero://ztoolkit-debug/?run=${encodeURIComponent(script)}`;
  const result = spawnSync(
    zoteroBinPath,
    ["--purgecaches", "-profile", profilePath, "-url", url],
    { stdio: "ignore" },
  );
  if (result.error) throw result.error;
  if (result.status && result.status !== 0) {
    throw new Error(`${action} exited with status ${result.status}`);
  }
}

async function main() {
  const releaseDevServerLock = acquireDevServerLock();
  let zoteroProcess;
  let developmentWatcher;
  let shutdownPromise;

  const shutdown = () => {
    shutdownPromise ??= (async () => {
      await developmentWatcher?.close();
      if (zoteroProcess && !zoteroProcess.killed) zoteroProcess.kill();
      releaseDevServerLock();
    })();
    return shutdownPromise;
  };

  try {
    await build();
    zoteroProcess = startZotero(() =>
      openZoteroURL(openDevToolScript, "Opening developer tools"),
    );
    developmentWatcher = await watch();
  } catch (error) {
    await shutdown();
    throw error;
  }
  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  zoteroProcess.once("close", (code) => {
    void shutdown().finally(() => {
      process.exitCode = code ?? 0;
    });
  });
}

main().catch((error) => {
  Logger.error(error);
  process.exitCode = 1;
});
