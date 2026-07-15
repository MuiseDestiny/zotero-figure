import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "@huggingface/transformers";
import {
  buildComparisonReport,
  renderComparisonHtml,
} from "./model-comparison-report.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const DEFAULT_PDF =
  "/Users/muisedestiny/Zotero/storage/53PSYCFH/Bilal和Nichol - 2015 - Evaluation of MODIS aerosol retrieval algorithms over the Beijing-Tianjin-Hebei region during low to.pdf";
const DEFAULT_ZOTERO_APP = "/Applications/Zotero.app";
const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL_INPUT_SIZE = { height: 640, width: 640 };
const CLASS_THRESHOLDS = {
  0: 0.25,
  1: 0.1,
  2: 0.5,
  5: 0.25,
  default: 0.1,
};
const RELEVANT_TYPES = new Set([
  "figure",
  "figure_caption",
  "table",
  "table_caption",
]);
const CHROME_TIMEOUT_MS = 20 * 60 * 1000;

const options = parseArguments(process.argv.slice(2));
const runtimeDirectory = await mkdtemp(
  path.join(tmpdir(), "zotero-figure-model-comparison-"),
);
const outputDirectory = path.resolve(repositoryRoot, options.output);
const pagesDirectory = path.join(outputDirectory, "pages");
await mkdir(pagesDirectory, { recursive: true });

const pdfPath = path.resolve(options.pdf);
const zoteroOmniPath = path.join(
  path.resolve(options.zoteroApp),
  "Contents/Resources/app/omni.ja",
);
const chromePath = path.resolve(options.chrome);
await Promise.all([
  assertFile(pdfPath, "PDF"),
  assertFile(zoteroOmniPath, "Zotero application archive"),
  assertFile(chromePath, "Chrome executable"),
]);

const modelManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "model-manifest.json"), "utf8"),
);
const modelPath = await resolveModelPath(options.model, modelManifest);
const modelVariant = await identifyModelVariant(modelPath, modelManifest);
const pdfBuffer = await readFile(pdfPath);
const sourceHash = createHash("md5").update(pdfBuffer).digest("hex");

console.log(`PDF: ${pdfPath}`);
console.log(`DocLayout model: ${modelPath} (${modelVariant.id})`);
console.log(`Output: ${outputDirectory}`);

const renderStartedAt = Date.now();
const renderedPages = await renderPdfPages({
  dpi: options.dpi,
  maxPages: options.maxPages,
  outputDirectory: pagesDirectory,
  pdfPath,
});
console.log(
  `Rendered ${renderedPages.length} pages in ${formatDuration(renderStartedAt)}`,
);

const docLayoutStartedAt = Date.now();
const docLayoutPages = await runDocLayout({
  modelManifest,
  modelPath,
  modelVariant,
  renderedPages,
  runtimeDirectory,
});
const docLayoutMs = Date.now() - docLayoutStartedAt;
console.log(`DocLayout-YOLO finished in ${formatMilliseconds(docLayoutMs)}`);

const zoteroStartedAt = Date.now();
const sdtBuffer = await runZoteroDocumentWorker({
  chromePath,
  maxPages: options.maxPages,
  omniPath: zoteroOmniPath,
  pdfBuffer,
  runtimeDirectory,
  sourceHash,
});
const zoteroStructure = await materializeSdt({
  omniPath: zoteroOmniPath,
  runtimeDirectory,
  sdtBuffer,
});
const zoteroPages = extractZoteroPages(zoteroStructure, renderedPages.length);
const zoteroMs = Date.now() - zoteroStartedAt;
console.log(
  `Zotero document-worker finished in ${formatMilliseconds(zoteroMs)}`,
);

const applicationIni = await readFile(
  path.join(
    path.resolve(options.zoteroApp),
    "Contents/Resources/app/application.ini",
  ),
  "utf8",
);
const zoteroVersion = applicationIni.match(/^Version=(.+)$/m)?.[1] ?? "unknown";
const pdfTitle = await readPdfTitle(pdfPath);
const report = buildComparisonReport({
  docLayoutPages,
  metadata: {
    docLayoutModel: {
      hash: modelVariant.sha256,
      id: modelVariant.id,
      path: modelPath,
      quantized: modelVariant.quantized,
    },
    dpi: options.dpi,
    generatedAt: new Date().toISOString(),
    pdfPath,
    pdfTitle,
    sourceHash,
    timings: { docLayoutMs, zoteroMs },
    zoteroVersion,
  },
  zoteroPages,
});

await Promise.all([
  writeFile(
    path.join(outputDirectory, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  writeFile(
    path.join(outputDirectory, "index.html"),
    renderComparisonHtml(report),
  ),
  writeFile(path.join(outputDirectory, "zotero-output.sdt"), sdtBuffer),
  writeFile(
    path.join(outputDirectory, "zotero-structure.json"),
    `${JSON.stringify(zoteroStructure, null, 2)}\n`,
  ),
]);

console.log(
  `Agreement: ${report.summary.matchedSubjects}/${Math.max(
    report.summary.docLayoutSubjects,
    report.summary.zoteroSubjects,
  )} subject boxes (${Math.round(report.summary.subjectAgreement * 100)}%)`,
);
console.log(`Report: ${path.join(outputDirectory, "index.html")}`);

async function runDocLayout({
  modelManifest,
  modelPath,
  modelVariant,
  renderedPages,
  runtimeDirectory,
}) {
  const modelRoot = path.join(runtimeDirectory, "models");
  const localModelDirectory = path.join(modelRoot, modelManifest.modelName);
  const onnxDirectory = path.join(localModelDirectory, "onnx");
  await mkdir(onnxDirectory, { recursive: true });

  const sourceConfigDirectory = path.join(
    repositoryRoot,
    "addon/chrome/content/models",
    modelManifest.modelName,
  );
  await Promise.all([
    copyFile(
      path.join(sourceConfigDirectory, "config.json"),
      path.join(localModelDirectory, "config.json"),
    ),
    copyFile(
      path.join(sourceConfigDirectory, "preprocessor_config.json"),
      path.join(localModelDirectory, "preprocessor_config.json"),
    ),
    linkModel(modelPath, path.join(onnxDirectory, "model.onnx")),
    linkModel(modelPath, path.join(onnxDirectory, "model_quantized.onnx")),
  ]);

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = `${modelRoot}${path.sep}`;

  const configuration = await AutoConfig.from_pretrained(
    modelManifest.modelName,
    { quantized: modelVariant.quantized },
  );
  const labels = configuration.id2label;
  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained(modelManifest.modelName, {
      device: "cpu",
      quantized: modelVariant.quantized,
    }),
    AutoProcessor.from_pretrained(modelManifest.modelName),
  ]);
  processor.feature_extractor.size = MODEL_INPUT_SIZE;

  const pages = [];
  for (const renderedPage of renderedPages) {
    const pageStartedAt = Date.now();
    const image = await RawImage.read(renderedPage.absolutePath);
    const { pixel_values: pixelValues } = await processor(image, {
      do_pad: true,
      size: MODEL_INPUT_SIZE,
    });
    const output = await model({ images: pixelValues });
    const tensor = output.output0 ?? output.images;
    if (!tensor?.data || !tensor?.dims) {
      throw new Error("DocLayout model returned an unsupported output tensor");
    }
    const detections = nonMaxSuppression(
      decodeDetections(tensor, labels),
    ).filter((detection) => RELEVANT_TYPES.has(detection.type));
    pages.push({
      detections,
      height: image.height,
      image: renderedPage.relativePath,
      index: renderedPage.index,
      inferenceMs: Date.now() - pageStartedAt,
      width: image.width,
    });
    console.log(
      `  DocLayout page ${renderedPage.index + 1}/${renderedPages.length}: ${detections.length} relevant boxes`,
    );
  }
  await model.dispose?.();
  return pages;
}

async function runZoteroDocumentWorker({
  chromePath,
  maxPages,
  omniPath,
  pdfBuffer,
  runtimeDirectory,
  sourceHash,
}) {
  const archiveCache = new Map();
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/runner") {
        respond(
          response,
          "text/html; charset=utf-8",
          renderDocumentWorkerRunner({ maxPages, sourceHash }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/worker.js") {
        respond(
          response,
          "text/javascript; charset=utf-8",
          await readArchiveEntry(
            omniPath,
            "resource/document-worker/worker.js",
            archiveCache,
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/pdf") {
        respond(response, "application/pdf", pdfBuffer);
        return;
      }
      if (request.method === "GET" && url.pathname === "/asset") {
        const requestedPath = url.searchParams.get("path");
        if (!requestedPath || requestedPath.includes("..")) {
          throw new Error("Invalid document-worker asset path");
        }
        const archivePath =
          requestedPath.startsWith("cmaps/") ||
          requestedPath.startsWith("standard_fonts/")
            ? `resource/reader/pdf/web/${requestedPath}`
            : `resource/document-worker/${requestedPath}`;
        respond(
          response,
          contentTypeFor(requestedPath),
          await readArchiveEntry(omniPath, archivePath, archiveCache),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/result") {
        const body = await readRequestBody(request, 200 * 1024 * 1024);
        respond(response, "application/json", JSON.stringify({ ok: true }));
        resolveResult(body);
        return;
      }
      if (request.method === "POST" && url.pathname === "/error") {
        const body = await readRequestBody(request, 1024 * 1024);
        const message = body.toString("utf8") || "Unknown browser worker error";
        respond(response, "application/json", JSON.stringify({ ok: true }));
        rejectResult(new Error(message));
        return;
      }
      response.writeHead(404).end("Not found");
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.stack : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine benchmark server port");
  }

  const chromeProfile = path.join(runtimeDirectory, "chrome-profile");
  await mkdir(chromeProfile, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      `--user-data-dir=${chromeProfile}`,
      `http://127.0.0.1:${address.port}/runner`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let chromeErrors = "";
  chrome.stderr.on("data", (chunk) => {
    chromeErrors += chunk.toString();
    if (chromeErrors.length > 32_000)
      chromeErrors = chromeErrors.slice(-32_000);
  });

  let timeoutID;
  try {
    return await Promise.race([
      resultPromise,
      new Promise((_, reject) => {
        timeoutID = setTimeout(() => {
          reject(
            new Error(
              `Zotero document-worker timed out. Chrome output:\n${chromeErrors}`,
            ),
          );
        }, CHROME_TIMEOUT_MS);
      }),
      new Promise((_, reject) => {
        chrome.once("exit", (code) => {
          reject(
            new Error(
              `Chrome exited before document-worker completed (code ${code}).\n${chromeErrors}`,
            ),
          );
        });
      }),
    ]);
  } finally {
    clearTimeout(timeoutID);
    chrome.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
  }
}

async function materializeSdt({ omniPath, runtimeDirectory, sdtBuffer }) {
  const parserPath = path.join(
    runtimeDirectory,
    "structured-document-text.cjs",
  );
  await writeFile(
    parserPath,
    await readArchiveEntry(
      omniPath,
      "resource/document-worker/structured-document-text.js",
      new Map(),
    ),
  );
  const require = createRequire(import.meta.url);
  const { openStructuredDocumentTextPack } = require(parserPath);
  const reader = await openStructuredDocumentTextPack(sdtBuffer, {
    inflate: (bytes) => inflateRawSync(bytes),
  });
  return reader.materialize();
}

function extractZoteroPages(structure, pageLimit) {
  const catalogPages = Array.isArray(structure?.catalog?.pages)
    ? structure.catalog.pages
    : [];
  const pages = Array.from({ length: pageLimit }, (_, index) => ({
    detections: [],
    index,
    viewRect: catalogPages[index]?.viewRect ?? [0, 0, 1, 1],
  }));

  const visit = (node) => {
    if (!node || typeof node !== "object" || typeof node.text === "string") {
      return;
    }
    if (["image", "table", "caption"].includes(node.type)) {
      const text = getNodeText(node).trim();
      const type = toComparableZoteroType(node.type, text);
      for (const pageRect of node.anchor?.pageRects ?? []) {
        const [pageIndex, ...rect] = pageRect;
        if (!pages[pageIndex] || rect.length !== 4) continue;
        pages[pageIndex].detections.push({
          flowClass: node.flowClass,
          rect,
          score: null,
          text,
          type,
        });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const block of structure.content ?? []) visit(block);
  return pages;
}

function renderDocumentWorkerRunner({ maxPages, sourceHash }) {
  return `<!doctype html><meta charset="utf-8"><title>Zotero document-worker benchmark</title><pre id="status">Starting</pre><script type="module">
const status = document.getElementById("status");
const worker = new Worker("/worker.js");
const pending = new Map();
let nextID = 0;

worker.onmessage = async event => {
  const message = event.data;
  if (message.action === "FetchData") {
    try {
      const response = await fetch("/asset?path=" + encodeURIComponent(message.data));
      if (!response.ok) throw new Error(message.data + ": " + response.status);
      const data = await response.arrayBuffer();
      worker.postMessage({ responseID: message.id, data }, [data]);
    } catch (error) {
      worker.postMessage({ responseID: message.id, error: { message: error.message } });
    }
    return;
  }
  if ("progressID" in message) {
    status.textContent = "Zotero document-worker: " + message.data.progress + "%";
    return;
  }
  const call = pending.get(message.responseID);
  if (!call) return;
  pending.delete(message.responseID);
  if (message.error) call.reject(new Error(message.error.message || JSON.stringify(message.error)));
  else call.resolve(message.data);
};

function callWorker(action, data, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++nextID;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, data }, transfer);
  });
}

try {
  const pdf = await fetch("/pdf").then(response => response.arrayBuffer());
  const result = await callWorker("getStructuredDocumentText", {
    buf: pdf,
    contentType: "application/pdf",
    maxPages: ${JSON.stringify(maxPages)},
    password: "",
    reportProgress: true,
    sourceHash: ${JSON.stringify(sourceHash)},
  }, [pdf]);
  const response = await fetch("/result", { method: "POST", body: result.buf });
  if (!response.ok) throw new Error("Failed to upload SDT result: " + response.status);
  status.textContent = "Done";
} catch (error) {
  status.textContent = error.stack || error.message || String(error);
  await fetch("/error", { method: "POST", body: status.textContent });
} finally {
  worker.terminate();
}
</script>`;
}

async function renderPdfPages({ dpi, maxPages, outputDirectory, pdfPath }) {
  const prefix = path.join(outputDirectory, "page");
  const argumentsList = ["-jpeg", "-r", String(dpi)];
  if (maxPages) argumentsList.push("-f", "1", "-l", String(maxPages));
  argumentsList.push(pdfPath, prefix);
  await execFileAsync("pdftoppm", argumentsList, {
    maxBuffer: 20 * 1024 * 1024,
  });
  const files = (await readdir(outputDirectory))
    .filter((file) => /^page-\d+\.jpg$/u.test(file))
    .sort((first, second) => first.localeCompare(second, "en"));
  if (!files.length) throw new Error("pdftoppm did not render any pages");
  return files.map((file, index) => ({
    absolutePath: path.join(outputDirectory, file),
    index,
    relativePath: `pages/${file}`,
  }));
}

function decodeDetections(tensor, labels) {
  const { data, dims } = tensor;
  const anchorCount = dims[2];
  const classCount = dims[1] - 4;
  const detections = [];

  for (let anchor = 0; anchor < anchorCount; anchor++) {
    let bestClassID = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let classID = 0; classID < classCount; classID++) {
      const score = data[anchor + (4 + classID) * anchorCount];
      if (score > bestScore) {
        bestClassID = classID;
        bestScore = score;
      }
    }
    const threshold = CLASS_THRESHOLDS[bestClassID] ?? CLASS_THRESHOLDS.default;
    if (bestScore <= threshold) continue;
    const centerX = data[anchor];
    const centerY = data[anchor + anchorCount];
    const width = data[anchor + 2 * anchorCount];
    const height = data[anchor + 3 * anchorCount];
    const absoluteRect = [
      centerX - width / 2,
      centerY - height / 2,
      centerX + width / 2,
      centerY + height / 2,
    ];
    detections.push({
      absoluteRect,
      classID: bestClassID,
      score: Number(bestScore),
      text: "",
      type: labels[bestClassID] ?? `unknown_${bestClassID}`,
      xyxy: [
        clamp(absoluteRect[0] / MODEL_INPUT_SIZE.width),
        clamp(absoluteRect[1] / MODEL_INPUT_SIZE.height),
        clamp(absoluteRect[2] / MODEL_INPUT_SIZE.width),
        clamp(absoluteRect[3] / MODEL_INPUT_SIZE.height),
      ].map((value) => Math.round(value * 10_000) / 10_000),
    });
  }
  return detections;
}

function nonMaxSuppression(detections, threshold = 0.45) {
  const sorted = [...detections].sort(
    (first, second) => second.score - first.score,
  );
  const selected = [];
  while (sorted.length) {
    const current = sorted.shift();
    selected.push(current);
    for (let index = sorted.length - 1; index >= 0; index--) {
      const candidate = sorted[index];
      if (
        current.classID === candidate.classID &&
        intersectionOverUnion(current.absoluteRect, candidate.absoluteRect) >
          threshold
      ) {
        sorted.splice(index, 1);
      }
    }
  }
  return selected.map(({ absoluteRect, classID, ...detection }) => detection);
}

async function readArchiveEntry(omniPath, entryPath, cache) {
  if (!cache.has(entryPath)) {
    cache.set(
      entryPath,
      execFileAsync("unzip", ["-p", omniPath, entryPath], {
        encoding: "buffer",
        maxBuffer: 100 * 1024 * 1024,
      }).then(({ stdout }) => stdout),
    );
  }
  return cache.get(entryPath);
}

async function identifyModelVariant(modelPath, manifest) {
  const modelStat = await stat(modelPath);
  const hash = createHash("sha256")
    .update(await readFile(modelPath))
    .digest("hex");
  const variant = manifest.variants.find(
    (candidate) =>
      candidate.size === modelStat.size && candidate.sha256 === hash,
  );
  if (!variant) {
    throw new Error(
      `Model does not match a known manifest variant: ${modelPath} (${modelStat.size} bytes, ${hash})`,
    );
  }
  return variant;
}

async function resolveModelPath(explicitPath, manifest) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    await assertFile(resolved, "DocLayout model");
    return resolved;
  }
  const recommended = manifest.variants.find(
    ({ id }) => id === manifest.recommendedVariant,
  );
  if (!recommended) throw new Error("Recommended model is missing");
  for (const candidate of [
    path.join(repositoryRoot, "addon/chrome/content", recommended.embeddedPath),
    path.join(
      homedir(),
      "Downloads/doclayout_yolo_docstructbench_imgsz1280_2501_quantized.onnx",
    ),
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Unable to locate a configured DocLayout ONNX model");
}

function parseArguments(argumentsList) {
  const result = {
    chrome: DEFAULT_CHROME,
    dpi: 120,
    maxPages: null,
    model: null,
    output: "docs/model-comparison/bilal-2015",
    pdf: DEFAULT_PDF,
    zoteroApp: DEFAULT_ZOTERO_APP,
  };
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--pdf")
      result.pdf = requireValue(argument, value, ++index);
    else if (argument === "--model")
      result.model = requireValue(argument, value, ++index);
    else if (argument === "--output")
      result.output = requireValue(argument, value, ++index);
    else if (argument === "--zotero-app")
      result.zoteroApp = requireValue(argument, value, ++index);
    else if (argument === "--chrome")
      result.chrome = requireValue(argument, value, ++index);
    else if (argument === "--dpi")
      result.dpi = Number(requireValue(argument, value, ++index));
    else if (argument === "--max-pages")
      result.maxPages = Number(requireValue(argument, value, ++index));
    else if (argument === "--help") {
      console.log(
        `Usage: npm run compare:models -- [options]\n\n` +
          `  --pdf <path>         PDF to evaluate\n` +
          `  --model <path>       DocLayout ONNX model (defaults to Zotero preference)\n` +
          `  --output <path>      Report directory relative to the repository\n` +
          `  --zotero-app <path>  Zotero.app path\n` +
          `  --chrome <path>      Chrome executable path\n` +
          `  --dpi <number>       Render DPI (default: 120)\n` +
          `  --max-pages <number> Limit pages for a quick run`,
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isFinite(result.dpi) || result.dpi < 72 || result.dpi > 300) {
    throw new Error("--dpi must be between 72 and 300");
  }
  if (
    result.maxPages !== null &&
    (!Number.isInteger(result.maxPages) || result.maxPages < 1)
  ) {
    throw new Error("--max-pages must be a positive integer");
  }
  return result;
}

function requireValue(argument, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}

async function linkModel(source, target) {
  try {
    await symlink(source, target);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function assertFile(filePath, label) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}`, { cause: error });
  }
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("Request body exceeded the configured limit"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function respond(response, contentType, body) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function getNodeText(node) {
  if (typeof node?.text === "string") return node.text;
  if (!Array.isArray(node?.content)) return "";
  return node.content.map(getNodeText).join("");
}

function toComparableZoteroType(type, text) {
  if (type === "image") return "figure";
  if (type === "table") return "table";
  if (/^\s*(?:table|tab\.)\b/iu.test(text)) return "table_caption";
  if (/^\s*(?:figure|fig\.)\b/iu.test(text)) return "figure_caption";
  return "caption";
}

async function readPdfTitle(pdfPath) {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return (
      stdout.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || path.basename(pdfPath)
    );
  } catch {
    return path.basename(pdfPath);
  }
}

function intersectionOverUnion(first, second) {
  const left = Math.max(first[0], second[0]);
  const top = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const bottom = Math.min(first[3], second[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const firstArea =
    Math.max(0, first[2] - first[0]) * Math.max(0, first[3] - first[1]);
  const secondArea =
    Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
  return intersection / (firstArea + secondArea - intersection + 1e-6);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function formatDuration(startedAt) {
  return formatMilliseconds(Date.now() - startedAt);
}

function formatMilliseconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
