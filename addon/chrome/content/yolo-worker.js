import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "./transformers/dist/transformers.js";

const MODEL_SIZE = 640;
const MODEL_INPUT_SIZE = { height: MODEL_SIZE, width: MODEL_SIZE };
const MAX_INFERENCE_THREADS = 4;
const RESERVED_UI_THREADS = 2;
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

const originalFetch = self.fetch.bind(self);
let modelBytes;
let model;
let processor;
let selectiveOutput;
let labels = {};

env.allowRemoteModels = false;
env.allowLocalModels = true;

self.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.endsWith(".onnx") && modelBytes) {
    return new Response(modelBytes, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  return originalFetch(input, init);
};

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "INIT") {
    await initialize(message);
    return;
  }
  if (message.type === "DETECT") await detect(message);
};

async function initialize(message) {
  if (model) {
    self.postMessage({ message: "Already initialized", type: "READY" });
    return;
  }

  try {
    const {
      expectedModelHash,
      expectedModelSize,
      modelBytes: providedModelBytes,
      modelName,
      modelURL,
      quantized,
      resourceBaseURL,
      wasmURL,
    } = message;
    const modelSource = providedModelBytes ? "bytes" : "url";
    const [loadedModelBytes, wasmResponse] = await Promise.all([
      providedModelBytes
        ? Promise.resolve(providedModelBytes)
        : fetchArrayBuffer(modelURL, "model"),
      originalFetch(wasmURL),
    ]);
    if (!wasmResponse.ok) {
      throw new Error("Unable to load the bundled WASM runtime");
    }
    modelBytes = loadedModelBytes;
    const wasmBinary = await wasmResponse.arrayBuffer();
    await validateModel(modelBytes, expectedModelSize, expectedModelHash);

    env.localModelPath = `${resourceBaseURL}models/`;
    env.backends.onnx.wasm.wasmPaths = `${resourceBaseURL}transformers/dist/`;
    env.backends.onnx.wasm.wasmBinary = wasmBinary;
    const inferenceThreads = getInferenceThreadCount();
    env.backends.onnx.wasm.numThreads = inferenceThreads;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.simd = true;
    const [configuration, loadedProcessor] = await Promise.all([
      AutoConfig.from_pretrained(modelName, { quantized }),
      AutoProcessor.from_pretrained(modelName),
    ]);
    labels = configuration.id2label;
    model = await AutoModel.from_pretrained(modelName, {
      config: configuration,
      device: "wasm",
      quantized,
    });
    selectiveOutput = resolveSelectiveOutput(model);
    processor = loadedProcessor;
    processor.feature_extractor.size = MODEL_INPUT_SIZE;
    modelBytes = undefined;
    env.backends.onnx.wasm.wasmBinary = undefined;
    const configuredInferenceThreads = normalizeThreadCount(
      env.backends.onnx.wasm.numThreads,
      inferenceThreads,
    );
    self.postMessage({
      diagnostics: {
        configuredInferenceThreads,
        crossOriginIsolated: self.crossOriginIsolated === true,
        modelSource,
        requestedInferenceThreads: inferenceThreads,
        selectiveOutputEnabled: Boolean(selectiveOutput),
        sharedArrayBufferAvailable: typeof SharedArrayBuffer !== "undefined",
      },
      inferenceThreads: configuredInferenceThreads,
      message: "DocLayout-YOLO initialized",
      type: "READY",
    });
  } catch (error) {
    self.postMessage({
      error: getErrorMessage(error),
      type: "ERROR",
    });
  }
}

async function fetchArrayBuffer(url, resourceName) {
  if (!url) throw new Error(`No ${resourceName} source was provided`);
  const response = await originalFetch(url);
  if (!response.ok)
    throw new Error(`Unable to load the bundled ${resourceName}`);
  return response.arrayBuffer();
}

async function validateModel(bytes, expectedSize, expectedHash) {
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `Bundled model size mismatch: expected ${expectedSize}, got ${bytes.byteLength}`,
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== expectedHash) {
    throw new Error(`Bundled model SHA-256 mismatch: ${hash}`);
  }
}

async function detect(message) {
  const { imageData, pageIndex, taskID } = message;
  const timings = {
    decodeMs: 0,
    inferenceMs: 0,
    postprocessMs: 0,
    preprocessMs: 0,
    queueMs: normalizeDuration(message.queueMs),
    totalMs: 0,
  };
  if (!model || !processor) {
    self.postMessage({
      error: "Model is not initialized",
      pageIndex,
      taskID,
      timings,
      type: "ERROR",
    });
    return;
  }

  const startedAt = now();
  let image;
  let output;
  let pixelValues;
  let results;
  let resolvedError;
  try {
    let stageStartedAt = now();
    image = await decodeJPEG(imageData);
    timings.decodeMs = elapsed(stageStartedAt);

    stageStartedAt = now();
    pixelValues = await preprocessImage(image);
    timings.preprocessMs = elapsed(stageStartedAt);
    image = undefined;

    stageStartedAt = now();
    output =
      selectiveOutput && pixelValues?.ort_tensor
        ? await selectiveOutput.session.run(
            { [selectiveOutput.inputName]: pixelValues.ort_tensor },
            ["output0"],
          )
        : await model({ images: pixelValues });
    timings.inferenceMs = elapsed(stageStartedAt);

    stageStartedAt = now();
    const tensor = output.output0 ?? output.images;
    if (!tensor?.data || !tensor?.dims) {
      throw new Error("The model returned an unsupported output tensor");
    }

    const detections = decodeDetections(tensor);
    results = nonMaxSuppression(detections);
    timings.postprocessMs = elapsed(stageStartedAt);
  } catch (error) {
    resolvedError = error;
  } finally {
    image = undefined;
    disposeTensor(pixelValues);
    disposeModelOutput(output);
    timings.totalMs = elapsed(startedAt);
  }

  if (resolvedError) {
    self.postMessage({
      error: getErrorMessage(resolvedError),
      pageIndex,
      taskID,
      timings,
      type: "ERROR",
    });
    return;
  }

  self.postMessage({ pageIndex, results, taskID, timings, type: "RESULT" });
}

async function decodeJPEG(imageData) {
  const blob = new Blob([imageData], { type: "image/jpeg" });
  if (
    typeof self.createImageBitmap !== "function" ||
    typeof self.OffscreenCanvas !== "function"
  ) {
    return RawImage.fromBlob(blob);
  }

  const bitmap = await self.createImageBitmap(blob);
  let canvas;
  try {
    canvas = new self.OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Unable to decode the rendered PDF page");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return new RawImage(pixels, bitmap.width, bitmap.height, 4);
  } finally {
    bitmap.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

async function preprocessImage(image) {
  const featureExtractor = processor.feature_extractor;
  if (typeof featureExtractor?.preprocess !== "function") {
    const { pixel_values: pixelValues } = await processor(image, {
      do_pad: true,
      size: MODEL_INPUT_SIZE,
    });
    return pixelValues;
  }

  const { pixel_values: pixelValues } = await featureExtractor.preprocess(
    image,
    { do_pad: true },
  );
  if (pixelValues.dims.length === 3) pixelValues.unsqueeze_(0);
  return pixelValues;
}

function resolveSelectiveOutput(loadedModel) {
  const session = loadedModel?.sessions?.model;
  if (
    typeof session?.run !== "function" ||
    !session.outputNames?.includes?.("output0")
  ) {
    return undefined;
  }
  const inputNames = session.inputNames;
  if (!Array.isArray(inputNames)) return undefined;
  const inputName = inputNames.includes("images")
    ? "images"
    : inputNames.length === 1
      ? inputNames[0]
      : undefined;
  return inputName ? { inputName, session } : undefined;
}

function decodeDetections(tensor) {
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
  const sorted = [...detections].sort((a, b) => b.score - a.score);
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
        computeIntersectionOverUnion(
          current.absoluteRect,
          candidate.absoluteRect,
        ) > threshold
      ) {
        suppressed[candidateIndex] = 1;
      }
    }
  }

  return selected.map(({ absoluteRect, classID, ...detection }) => detection);
}

function computeIntersectionOverUnion(first, second) {
  const left = Math.max(first[0], second[0]);
  const top = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const bottom = Math.min(first[3], second[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const firstArea = (first[2] - first[0]) * (first[3] - first[1]);
  const secondArea = (second[2] - second[0]) * (second[3] - second[1]);
  return intersection / (firstArea + secondArea - intersection + 1e-6);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function getInferenceThreadCount() {
  const availableThreads = Number(self.navigator?.hardwareConcurrency) || 2;
  return Math.max(
    1,
    Math.min(MAX_INFERENCE_THREADS, availableThreads - RESERVED_UI_THREADS),
  );
}

function disposeModelOutput(output) {
  if (!output || typeof output !== "object") return;
  const disposed = new Set();
  for (const value of Object.values(output)) {
    if (!value || typeof value !== "object" || disposed.has(value)) continue;
    disposed.add(value);
    disposeTensor(value);
  }
}

function disposeTensor(tensor) {
  try {
    tensor?.dispose?.();
  } catch {
    // CPU tensors may not own an explicitly disposable backing resource.
  }
}

function normalizeThreadCount(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeDuration(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function now() {
  return self.performance?.now?.() ?? Date.now();
}

function elapsed(startedAt) {
  return Math.round((now() - startedAt) * 100) / 100;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}
