import { build, transform } from "esbuild";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import details from "../package.json" with { type: "json" };
import { esbuildOptions } from "./build.mjs";

const result = await build({
  ...esbuildOptions,
  logLevel: "warning",
  metafile: true,
  write: false,
});
if (!result.outputFiles?.length) {
  throw new Error("Build check did not produce an output bundle");
}

const requiredInputs = [
  "src/domain/layout.ts",
  "src/domain/figureResults.ts",
  "src/features/reader/figureSidebarPanel.ts",
  "src/features/reader/figureReaderController.ts",
  "src/platform/zotero/pdfTranslate.ts",
  "src/platform/zotero/annotations.ts",
  "src/services/layout/layoutAnalyzer.ts",
  "src/services/layout/pageImageCropper.ts",
  "src/services/results/figureResultStore.ts",
  "src/services/layout/workerPool.ts",
  "src/services/model/modelCatalog.ts",
  "src/services/model/modelManager.ts",
  "src/utils/cancellation.ts",
];
const inputs = new Set(Object.keys(result.metafile?.inputs ?? {}));
for (const input of requiredInputs) {
  if (!inputs.has(input)) throw new Error(`Main bundle is missing ${input}`);
}

const requiredAssets = [
  "addon/chrome/content/figure-sidebar.css",
  "addon/chrome/content/preferences.css",
  "addon/chrome/content/models/darknoah99/DocLayout-YOLO-DocStructBench-onnx/config.json",
  "addon/chrome/content/models/darknoah99/DocLayout-YOLO-DocStructBench-onnx/preprocessor_config.json",
  "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs",
  "node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm",
  "node_modules/@huggingface/transformers/dist/transformers.js",
];
for (const asset of requiredAssets) {
  if (!existsSync(asset))
    throw new Error(`Required asset is missing: ${asset}`);
}

validateZotero9Manifest("addon/manifest.json");
validateZotero9UpdateTemplate("scripts/update-template.json");
const embeddedModel = validateModelManifest();
validateEmbeddedModel(embeddedModel);
validatePreferencesMarkup();

await transform(readFileSync("addon/chrome/content/yolo-worker.js", "utf8"), {
  loader: "js",
  target: "firefox128",
});

for (const key of [
  "addonID",
  "addonRef",
  "addonInstance",
  "updateLink",
  "updateURL",
]) {
  if (!details.config[key])
    throw new Error(`package.json config.${key} is missing`);
}

const bundleBytes = result.outputFiles.reduce(
  (total, output) => total + output.contents.byteLength,
  0,
);
console.log(`Build check passed (${bundleBytes} bundle bytes)`);

function validateZotero9Manifest(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const application = manifest.applications?.zotero;
  if (
    application?.strict_min_version !== "9.0" ||
    application?.strict_max_version !== "9.*"
  ) {
    throw new Error(`${file} must support Zotero 9 only`);
  }
}

function validateZotero9UpdateTemplate(file) {
  const template = JSON.parse(readFileSync(file, "utf8"));
  const updates = Object.values(template.addons ?? {})[0]?.updates;
  const application = updates?.[0]?.applications?.zotero;
  if (
    updates?.length !== 1 ||
    application?.strict_min_version !== "9.0" ||
    application?.strict_max_version !== "9.*"
  ) {
    throw new Error(`${file} must publish updates for Zotero 9 only`);
  }
}

function validateModelManifest() {
  const modelManifest = JSON.parse(readFileSync("model-manifest.json", "utf8"));
  const variants = modelManifest.variants;
  if (
    modelManifest.schemaVersion !== 1 ||
    !Array.isArray(variants) ||
    variants.length < 1
  ) {
    throw new Error("model-manifest.json has an unsupported structure");
  }
  const recommended = variants.find(
    ({ id }) => id === modelManifest.recommendedVariant,
  );
  if (!recommended) {
    throw new Error("Recommended model variant is missing from the manifest");
  }
  const ids = new Set();
  const fileNames = new Set();
  for (const variant of variants) {
    if (
      typeof variant.id !== "string" ||
      ids.has(variant.id) ||
      typeof variant.fileName !== "string" ||
      !variant.fileName.endsWith(".onnx") ||
      typeof variant.embeddedPath !== "string" ||
      !variant.embeddedPath.endsWith(`/${variant.fileName}`) ||
      fileNames.has(variant.fileName) ||
      !/^[a-f0-9]{64}$/.test(variant.sha256) ||
      !Number.isInteger(variant.size) ||
      variant.size < 1 ||
      typeof variant.quantized !== "boolean"
    ) {
      throw new Error(`Invalid model variant: ${variant.id ?? "unknown"}`);
    }
    ids.add(variant.id);
    fileNames.add(variant.fileName);
  }
  if (variants.length !== 1 || recommended.quantized !== true) {
    throw new Error("The embedded optimized Q8 model must be the only variant");
  }
  return recommended;
}

function validateEmbeddedModel(model) {
  const expectedPath = `addon/chrome/content/${model.embeddedPath}`;
  const onnxFiles = findFiles("addon").filter((file) => file.endsWith(".onnx"));
  if (onnxFiles.length !== 1 || onnxFiles[0] !== expectedPath) {
    throw new Error(
      `Plugin must embed exactly one model at ${expectedPath}: ${onnxFiles.join(", ")}`,
    );
  }
  const size = statSync(expectedPath).size;
  const sha256 = createHash("sha256")
    .update(readFileSync(expectedPath))
    .digest("hex");
  if (size !== model.size || sha256 !== model.sha256) {
    throw new Error(
      `Embedded model integrity mismatch: size=${size}, sha256=${sha256}`,
    );
  }
}

function validatePreferencesMarkup() {
  const markup = readFileSync("addon/chrome/content/preferences.xhtml", "utf8");
  for (const id of [
    "duplicate-mode",
    "managed-model-path",
    "model-metadata",
    "model-status",
    "model-status-row",
    "reveal-model",
    "restore-model",
    "sync-annotations",
    "verify-model",
  ]) {
    if (!markup.includes(`id="${id}"`)) {
      throw new Error(`Preferences markup is missing #${id}`);
    }
  }
  if (
    !markup.includes('href="preferences.css"') ||
    !/<html:select\s+id="duplicate-mode"\s+native="true">/.test(markup) ||
    markup.includes('id="model-path"')
  ) {
    throw new Error(
      "Preferences must use the native result selector and hide the immutable model path",
    );
  }
}

function findFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = `${directory}/${entry.name}`;
    return entry.isDirectory() ? findFiles(entryPath) : [entryPath];
  });
}
