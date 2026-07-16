import { build } from "esbuild";
import { zip } from "compressing";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import path from "path";
import { pathToFileURL } from "url";
import replaceInFile from "replace-in-file";
import details from "../package.json" with { type: "json" };
import modelManifest from "../model-manifest.json" with { type: "json" };
import {
  Logger,
  clearFolder,
  copyFileSync,
  copyFolderRecursiveSync,
  dateFormat,
} from "./utils.mjs";

const { replaceInFileSync } = replaceInFile;
const BUILD_DIR = "build";
const RUNTIME_DIST_FILES = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "transformers.js",
];
const MUPDF_DIST_FILES = ["mupdf-wasm.js", "mupdf-wasm.wasm", "mupdf.js"];
const EMBEDDED_MODEL = modelManifest.variants.find(
  ({ id }) => id === modelManifest.recommendedVariant,
);
if (!EMBEDDED_MODEL) throw new Error("Recommended embedded model is missing");
const EMBEDDED_MODEL_PATH = path.join(
  "addon/chrome/content",
  EMBEDDED_MODEL.embeddedPath,
);
const GENERATED_TRANSFORMERS_PATH = path.resolve(
  "addon/chrome/content/transformers",
);

process.env.NODE_ENV =
  process.argv[2] === "production" ? "production" : "development";

const { name, author, description, homepage, version, config } = details;
const isPreRelease = version.includes("-");
const updateURL = isPreRelease
  ? config.updateURL.replace("update.json", "update-beta.json")
  : config.updateURL;
const resolvedConfig = { ...config, updateURL };

export const esbuildOptions = {
  bundle: true,
  define: {
    __env__: `"${process.env.NODE_ENV}"`,
    __pluginIconDataURL__: JSON.stringify(
      `data:image/png;base64,${readFileSync(
        "addon/chrome/content/icons/favicon.png",
      ).toString("base64")}`,
    ),
  },
  entryPoints: {
    "gallery/gallery": "src/features/gallery/figureGalleryView.ts",
    [`scripts/${config.addonRef}`]: "src/index.ts",
  },
  outdir: path.join(BUILD_DIR, "addon/chrome/content"),
  sourcemap: process.env.NODE_ENV === "development" ? "inline" : false,
  target: "firefox128",
};

export async function main() {
  const startedAt = Date.now();
  const buildTime = dateFormat("YYYY-mm-dd HH:MM:SS", new Date());
  Logger.info(
    `[Build] dir=${BUILD_DIR}, version=${version}, time=${buildTime}, env=${process.env.NODE_ENV}`,
  );

  validateSourceAssets();
  clearFolder(BUILD_DIR);
  copyFolderRecursiveSync("addon", BUILD_DIR, {
    filter: (source) => path.resolve(source) !== GENERATED_TRANSFORMERS_PATH,
  });
  removeBuildNoise(path.join(BUILD_DIR, "addon"));
  removeLegacyAssets();
  prepareRuntimeAssets();
  replacePlaceholders(buildTime);
  prepareLocaleFiles();

  Logger.debug("[Build] Bundling plugin source");
  await build(esbuildOptions);

  if (process.env.NODE_ENV === "production") {
    prepareUpdateJson();
    Logger.debug("[Build] Packing XPI");
    await zip.compressDir(
      path.join(BUILD_DIR, "addon"),
      path.join(BUILD_DIR, `${name}.xpi`),
      { ignoreBase: true },
    );
  }

  Logger.info(`[Build] Finished in ${(Date.now() - startedAt) / 1_000} s`);
}

function validateSourceAssets() {
  const requiredFiles = [
    "addon/bootstrap.js",
    "addon/chrome/content/gallery/gallery.css",
    "addon/chrome/content/gallery/index.html",
    "addon/chrome/content/preferences.xhtml",
    "addon/chrome/content/mupdf-worker.js",
    "addon/chrome/content/yolo-worker.js",
    EMBEDDED_MODEL_PATH,
    "addon/chrome/content/models/darknoah99/DocLayout-YOLO-DocStructBench-onnx/config.json",
    "addon/chrome/content/models/darknoah99/DocLayout-YOLO-DocStructBench-onnx/preprocessor_config.json",
    "addon/manifest.json",
    "scripts/update-template.json",
    "src/features/gallery/figureGalleryView.ts",
    "node_modules/@huggingface/transformers/LICENSE",
    "node_modules/mupdf/LICENSE",
    ...MUPDF_DIST_FILES.map((file) => `node_modules/mupdf/dist/${file}`),
    ...RUNTIME_DIST_FILES.map(
      (file) => `node_modules/@huggingface/transformers/dist/${file}`,
    ),
  ];
  const missing = requiredFiles.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`Missing required build assets:\n${missing.join("\n")}`);
  }
  const size = statSync(EMBEDDED_MODEL_PATH).size;
  const sha256 = createHash("sha256")
    .update(readFileSync(EMBEDDED_MODEL_PATH))
    .digest("hex");
  if (size !== EMBEDDED_MODEL.size || sha256 !== EMBEDDED_MODEL.sha256) {
    throw new Error(
      `Embedded model integrity mismatch: size=${size}, sha256=${sha256}`,
    );
  }
}

function prepareRuntimeAssets() {
  const target = path.join(BUILD_DIR, "addon/chrome/content/transformers");
  const targetDist = path.join(target, "dist");
  clearFolder(target);
  mkdirSync(targetDist, { recursive: true });

  copyFileSync("node_modules/@huggingface/transformers/LICENSE", target);
  for (const file of RUNTIME_DIST_FILES) {
    copyFileSync(
      path.join("node_modules/@huggingface/transformers/dist", file),
      targetDist,
    );
  }

  const mupdfTarget = path.join(BUILD_DIR, "addon/chrome/content/mupdf");
  clearFolder(mupdfTarget);
  copyFileSync("node_modules/mupdf/LICENSE", mupdfTarget);
  for (const file of MUPDF_DIST_FILES) {
    copyFileSync(path.join("node_modules/mupdf/dist", file), mupdfTarget);
  }
}

function removeLegacyAssets() {
  for (const file of ["chrome.manifest", "install.rdf"]) {
    rmSync(path.join(BUILD_DIR, "addon", file), { force: true });
  }

  const localesPath = path.join(BUILD_DIR, "addon/locale");
  for (const locale of readdirSync(localesPath, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue;
    const localePath = path.join(localesPath, locale.name);
    for (const file of readdirSync(localePath, { withFileTypes: true })) {
      if (file.isFile() && !file.name.endsWith(".ftl")) {
        rmSync(path.join(localePath, file.name), { force: true });
      }
    }
  }
}

function replacePlaceholders(buildTime) {
  const replacements = {
    author,
    buildTime,
    buildTimestamp: String(Date.now()),
    buildVersion: version,
    description,
    homepage,
    ...resolvedConfig,
  };

  replaceInFileSync({
    countMatches: true,
    files: [
      `${BUILD_DIR}/addon/**/*.css`,
      `${BUILD_DIR}/addon/**/*.html`,
      `${BUILD_DIR}/addon/**/*.js`,
      `${BUILD_DIR}/addon/**/*.json`,
      `${BUILD_DIR}/addon/**/*.manifest`,
      `${BUILD_DIR}/addon/**/*.rdf`,
      `${BUILD_DIR}/addon/**/*.xhtml`,
    ],
    from: Object.keys(replacements).map((key) => new RegExp(`__${key}__`, "g")),
    to: Object.values(replacements),
  });
}

function prepareLocaleFiles() {
  const messagesInMarkup = new Set();
  replaceInFileSync({
    files: [`${BUILD_DIR}/addon/**/*.html`, `${BUILD_DIR}/addon/**/*.xhtml`],
    processor: (input) =>
      input.replace(/(data-l10n-id)="(\S*)"/g, (_, attribute, message) => {
        messagesInMarkup.add(message);
        return `${attribute}="${config.addonRef}-${message}"`;
      }),
  });

  const localesPath = path.join(BUILD_DIR, "addon/locale");
  const localeNames = readdirSync(localesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const localeName of localeNames) {
    const localePath = path.join(localesPath, localeName);
    const fluentFiles = readdirSync(localePath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ftl"))
      .map((entry) => entry.name);

    for (const file of fluentFiles) {
      renameSync(
        path.join(localePath, file),
        path.join(localePath, `${config.addonRef}-${file}`),
      );
    }

    const localizedMessages = new Set();
    replaceInFileSync({
      files: [`${localePath}/*.ftl`],
      processor: (content) =>
        content
          .split("\n")
          .map((line) => {
            const match = line.match(/^([a-zA-Z]\S*)([ ]*=[ ]*)(.*)$/);
            if (!match) return line;
            localizedMessages.add(match[1]);
            return `${config.addonRef}-${line}`;
          })
          .join("\n"),
    });

    const missing = [...messagesInMarkup].filter(
      (message) => !localizedMessages.has(message),
    );
    if (missing.length > 0) {
      throw new Error(
        `Locale ${localeName} is missing markup messages: ${missing.join(", ")}`,
      );
    }
  }
}

function prepareUpdateJson() {
  const outputFile = isPreRelease ? "update-beta.json" : "update.json";
  copyFileSync("scripts/update-template.json", outputFile);
  const updateLink = isPreRelease
    ? config.updateLink.replace("/latest/download/", `/download/v${version}/`)
    : config.updateLink;

  replaceInFileSync({
    countMatches: true,
    files: [outputFile],
    from: [/__addonID__/g, /__buildVersion__/g, /__updateLink__/g],
    to: [config.addonID, version, updateLink],
  });
  Logger.debug(`[Build] Prepared ${outputFile}`);
}

function removeBuildNoise(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.name === ".DS_Store") {
      rmSync(entryPath, { force: true });
    } else if (entry.isDirectory()) {
      removeBuildNoise(entryPath);
    }
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    Logger.error(error);
    process.exitCode = 1;
  });
}
