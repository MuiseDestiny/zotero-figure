import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  AutoProcessor,
  RawImage,
  env as transformersEnvironment,
} from "@huggingface/transformers";
import mupdf, { emptyStore } from "mupdf";
import * as ort from "onnxruntime-web";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const MODEL_SIZE = 640;
const MODEL_INPUT_SIZE = { height: MODEL_SIZE, width: MODEL_SIZE };
const DETECTION_JPEG_QUALITY = 85;
const DEFAULT_CORPUS = path.join(
  process.env.HOME ?? "",
  "Documents/Zotero/功能/解析图表",
);
const RELEVANT_LAYOUT_TYPES = new Set([
  "figure",
  "figure_caption",
  "table",
  "table_caption",
]);
const CLASS_THRESHOLDS = {
  0: 0.25,
  1: 0.1,
  2: 0.5,
  5: 0.25,
  default: 0.1,
};

const options = parseArguments(process.argv.slice(2));
const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "model-manifest.json"), "utf8"),
);
const baselineVariant = manifest.variants.find(
  ({ id }) => id === manifest.recommendedVariant,
);
if (!baselineVariant) throw new Error("Recommended model is missing");

const modelDirectory = path.join(
  repositoryRoot,
  "addon/chrome/content/models",
  manifest.modelName,
);
const modelCandidates = [
  {
    id: "baseline",
    path: path.join(
      repositoryRoot,
      "addon/chrome/content",
      baselineVariant.embeddedPath,
    ),
  },
  ...options.models,
];
const pdfPaths =
  options.pdfs.length > 0
    ? options.pdfs.map((value) => path.resolve(value))
    : await discoverCorpusPdfs(options.corpus, options.pdfCount);

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.simd = true;
transformersEnvironment.allowLocalModels = true;
transformersEnvironment.allowRemoteModels = false;
transformersEnvironment.localModelPath = path.join(
  repositoryRoot,
  "addon/chrome/content/models",
);

const processor = await AutoProcessor.from_pretrained(manifest.modelName);
processor.feature_extractor.size = MODEL_INPUT_SIZE;
const labels = JSON.parse(
  await readFile(path.join(modelDirectory, "config.json"), "utf8"),
).id2label;

console.log(`PDFs: ${pdfPaths.length}`);
for (const pdfPath of pdfPaths) console.log(`  ${pdfPath}`);
console.log(`Candidates: ${modelCandidates.length}`);

const samples = await prepareSamples(pdfPaths, options.pagesPerPdf, processor);
if (samples.length === 0) throw new Error("No PDF pages were prepared");
console.log(`Prepared ${samples.length} identical input tensors`);

const candidateReports = [];
let baselineOutputs;
let baselineDetections;
for (const candidate of modelCandidates) {
  const modelBytes = await readFile(candidate.path);
  const hash = createHash("sha256").update(modelBytes).digest("hex");
  const sessionStartedAt = performance.now();
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  const initializationMs = performance.now() - sessionStartedAt;
  const inputName = session.inputNames.includes("images")
    ? "images"
    : session.inputNames.length === 1
      ? session.inputNames[0]
      : undefined;
  if (!inputName || !session.outputNames.includes("output0")) {
    throw new Error(`${candidate.id} has an unsupported input/output contract`);
  }

  const coldStartedAt = performance.now();
  const coldOutput = await runInference(session, inputName, samples[0]);
  const coldInferenceMs = performance.now() - coldStartedAt;
  coldOutput.dispose?.();

  const warmLatencies = [];
  const outputs = [];
  const detections = [];
  for (let runIndex = 0; runIndex < options.warmRuns; runIndex++) {
    for (const sample of samples) {
      const startedAt = performance.now();
      const output = await runInference(session, inputName, sample);
      warmLatencies.push(performance.now() - startedAt);
      if (runIndex === 0) {
        const copied = new Float32Array(output.data);
        outputs.push(copied);
        detections.push(
          nonMaxSuppression(decodeDetections(copied, output.dims, labels)),
        );
      }
      output.dispose?.();
    }
  }
  await session.release();

  const comparison = baselineOutputs
    ? compareCandidate(baselineOutputs, baselineDetections, outputs, detections)
    : {
        detectionEquivalent: true,
        exactOutput: true,
        maximumAbsoluteDifference: 0,
        mismatchedValues: 0,
      };
  baselineOutputs ??= outputs;
  baselineDetections ??= detections;
  const sortedLatencies = [...warmLatencies].sort(
    (first, second) => first - second,
  );
  const warmTotalMs = warmLatencies.reduce((sum, value) => sum + value, 0);
  const report = {
    coldInferenceMs: round(coldInferenceMs),
    comparison,
    id: candidate.id,
    initializationMs: round(initializationMs),
    model: {
      bytes: modelBytes.byteLength,
      path: candidate.path,
      sha256: hash,
    },
    warm: {
      meanMs: round(warmTotalMs / warmLatencies.length),
      medianMs: round(percentile(sortedLatencies, 0.5)),
      p95Ms: round(percentile(sortedLatencies, 0.95)),
      runs: warmLatencies.length,
      throughputPagesPerSecond: round(
        warmLatencies.length / (warmTotalMs / 1_000),
      ),
    },
  };
  candidateReports.push(report);
  console.log(
    `${candidate.id}: ${report.warm.meanMs} ms/page, ` +
      `${report.warm.throughputPagesPerSecond} pages/s, ` +
      `exact=${comparison.exactOutput}, detections=${comparison.detectionEquivalent}`,
  );
}

const baselineMean = candidateReports[0].warm.meanMs;
for (const report of candidateReports) {
  report.warm.changeFromBaselinePercent = round(
    ((report.warm.meanMs - baselineMean) / baselineMean) * 100,
  );
}
const result = {
  candidates: candidateReports,
  generatedAt: new Date().toISOString(),
  runtime: {
    onnxRuntimeWeb: ort.env.versions.web,
    threads: ort.env.wasm.numThreads,
  },
  samples: samples.map(({ id }) => id),
};
if (options.output) {
  await writeFile(
    path.resolve(options.output),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}
console.log(JSON.stringify(result, null, 2));

for (const sample of samples) sample.data = new Float32Array(0);
emptyStore();

async function prepareSamples(pdfPaths, pagesPerPdf, loadedProcessor) {
  const prepared = [];
  for (const pdfPath of pdfPaths) {
    const bytes = await readFile(pdfPath);
    const document = mupdf.Document.openDocument(bytes, "application/pdf");
    try {
      const pageIndices = selectPageIndices(document.countPages(), pagesPerPdf);
      for (const pageIndex of pageIndices) {
        const page = document.loadPage(pageIndex);
        let pixmap;
        try {
          const bounds = page.getBounds();
          const scale =
            MODEL_SIZE / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
          pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            false,
            "View",
            "CropBox",
          );
          const jpeg = pixmap.asJPEG(DETECTION_JPEG_QUALITY);
          const image = await RawImage.fromBlob(
            new Blob([jpeg], { type: "image/jpeg" }),
          );
          const { pixel_values: pixelValues } =
            await loadedProcessor.feature_extractor.preprocess(image, {
              do_pad: true,
            });
          if (pixelValues.dims.length === 3) pixelValues.unsqueeze_(0);
          prepared.push({
            data: new Float32Array(pixelValues.data),
            dims: [...pixelValues.dims],
            id: `${path.basename(pdfPath)}#${pageIndex + 1}`,
          });
          pixelValues.dispose?.();
        } finally {
          pixmap?.destroy();
          page.destroy();
        }
      }
    } finally {
      document.destroy();
    }
  }
  return prepared;
}

async function runInference(session, inputName, sample) {
  const input = new ort.Tensor("float32", sample.data, sample.dims);
  try {
    const output = await session.run({ [inputName]: input }, ["output0"]);
    const tensor = output.output0;
    if (!tensor?.data || !tensor?.dims) {
      throw new Error("Model returned an invalid output0 tensor");
    }
    return tensor;
  } finally {
    input.dispose?.();
  }
}

function compareCandidate(
  expectedOutputs,
  expectedDetections,
  actualOutputs,
  actualDetections,
) {
  if (actualOutputs.length !== expectedOutputs.length) {
    throw new Error("Candidate output count differs from the baseline");
  }
  let maximumAbsoluteDifference = 0;
  let mismatchedValues = 0;
  for (let pageIndex = 0; pageIndex < expectedOutputs.length; pageIndex++) {
    const expected = expectedOutputs[pageIndex];
    const actual = actualOutputs[pageIndex];
    if (actual.length !== expected.length) {
      throw new Error("Candidate output shape differs from the baseline");
    }
    for (let index = 0; index < expected.length; index++) {
      const difference = Math.abs(expected[index] - actual[index]);
      if (difference !== 0) mismatchedValues++;
      maximumAbsoluteDifference = Math.max(
        maximumAbsoluteDifference,
        difference,
      );
    }
  }
  return {
    detectionEquivalent:
      JSON.stringify(actualDetections) === JSON.stringify(expectedDetections),
    exactOutput: mismatchedValues === 0,
    maximumAbsoluteDifference,
    mismatchedValues,
  };
}

function decodeDetections(data, dims, labels) {
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
    const type = labels[bestClassID] ?? `unknown_${bestClassID}`;
    if (!RELEVANT_LAYOUT_TYPES.has(type)) continue;
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
      score: bestScore,
      type,
      xyxy: [
        clamp(absoluteRect[0] / MODEL_SIZE),
        clamp(absoluteRect[1] / MODEL_SIZE),
        clamp(absoluteRect[2] / MODEL_SIZE),
        clamp(absoluteRect[3] / MODEL_SIZE),
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
  const suppressed = new Uint8Array(sorted.length);
  for (let currentIndex = 0; currentIndex < sorted.length; currentIndex++) {
    if (suppressed[currentIndex]) continue;
    const current = sorted[currentIndex];
    selected.push(current);
    for (
      let candidateIndex = currentIndex + 1;
      candidateIndex < sorted.length;
      candidateIndex++
    ) {
      if (suppressed[candidateIndex]) continue;
      const candidate = sorted[candidateIndex];
      if (
        current.classID === candidate.classID &&
        intersectionOverUnion(current.absoluteRect, candidate.absoluteRect) >
          threshold
      ) {
        suppressed[candidateIndex] = 1;
      }
    }
  }
  return selected.map(({ absoluteRect, classID, ...detection }) => detection);
}

function intersectionOverUnion(first, second) {
  const left = Math.max(first[0], second[0]);
  const top = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const bottom = Math.min(first[3], second[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const firstArea = (first[2] - first[0]) * (first[3] - first[1]);
  const secondArea = (second[2] - second[0]) * (second[3] - second[1]);
  return intersection / (firstArea + secondArea - intersection + 1e-6);
}

async function discoverCorpusPdfs(corpus, limit) {
  const resolvedCorpus = path.resolve(corpus);
  const candidates = [];
  await collectPdfs(resolvedCorpus, candidates);
  candidates.sort((first, second) => first.localeCompare(second, "en"));
  if (candidates.length === 0) {
    throw new Error(`No PDFs found under ${resolvedCorpus}`);
  }
  return selectEvenly(candidates, Math.min(limit, candidates.length));
}

async function collectPdfs(directory, candidates) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectPdfs(entryPath, candidates);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;
    if (/\.(?:magic|no_watermark(?:\.zh\.dual)?)\.pdf$/iu.test(entry.name)) {
      continue;
    }
    candidates.push(entryPath);
  }
}

function selectPageIndices(pageCount, limit) {
  return selectEvenly(
    Array.from({ length: pageCount }, (_, index) => index),
    Math.min(pageCount, limit),
  );
}

function selectEvenly(values, count) {
  if (count >= values.length) return values;
  if (count === 1) return [values[Math.floor(values.length / 2)]];
  const selected = [];
  for (let index = 0; index < count; index++) {
    selected.push(
      values[Math.round((index * (values.length - 1)) / (count - 1))],
    );
  }
  return selected;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  return sortedValues[
    Math.min(
      sortedValues.length - 1,
      Math.floor(sortedValues.length * fraction),
    )
  ];
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parseArguments(argumentsList) {
  const result = {
    corpus: DEFAULT_CORPUS,
    models: [],
    output: undefined,
    pagesPerPdf: 3,
    pdfCount: 3,
    pdfs: [],
    warmRuns: 2,
  };
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--corpus") {
      result.corpus = requireValue(argument, value);
      index++;
    } else if (argument === "--pdf") {
      result.pdfs.push(requireValue(argument, value));
      index++;
    } else if (argument === "--model") {
      const input = requireValue(argument, value);
      const separator = input.indexOf("=");
      if (separator < 1)
        throw new Error("--model must use id=/path/model.onnx");
      result.models.push({
        id: input.slice(0, separator),
        path: path.resolve(input.slice(separator + 1)),
      });
      index++;
    } else if (argument === "--output") {
      result.output = requireValue(argument, value);
      index++;
    } else if (argument === "--pages-per-pdf") {
      result.pagesPerPdf = Number(requireValue(argument, value));
      index++;
    } else if (argument === "--pdf-count") {
      result.pdfCount = Number(requireValue(argument, value));
      index++;
    } else if (argument === "--warm-runs") {
      result.warmRuns = Number(requireValue(argument, value));
      index++;
    } else if (argument === "--help") {
      console.log(
        "Usage: node scripts/benchmark-layout-models.mjs [options]\n\n" +
          "  --corpus <dir>          PDF corpus used when --pdf is omitted\n" +
          "  --pdf <path>            PDF to sample (repeatable)\n" +
          "  --model <id=path>       Candidate ONNX model (repeatable)\n" +
          "  --pdf-count <number>    PDFs selected evenly from corpus (default: 3)\n" +
          "  --pages-per-pdf <n>     Pages selected evenly per PDF (default: 3)\n" +
          "  --warm-runs <number>    Timed passes over all pages (default: 2)\n" +
          "  --output <path>         Optional JSON report path",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  for (const [name, value] of [
    ["--pdf-count", result.pdfCount],
    ["--pages-per-pdf", result.pagesPerPdf],
    ["--warm-runs", result.warmRuns],
  ]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  return result;
}

function requireValue(argument, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}
