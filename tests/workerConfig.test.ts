import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(
  "addon/chrome/content/yolo-worker.js",
  "utf8",
);

test("keeps detection input fixed while bounding inference CPU use", () => {
  assert.match(workerSource, /const MODEL_SIZE = 640/);
  assert.match(workerSource, /const MAX_INFERENCE_THREADS = 4/);
  assert.match(workerSource, /const RESERVED_UI_THREADS = 2/);
  assert.match(
    workerSource,
    /Math\.min\(MAX_INFERENCE_THREADS, availableThreads - RESERVED_UI_THREADS\)/,
  );
});

test("requests only the output tensor consumed by detection", () => {
  assert.match(workerSource, /loadedModel\?\.sessions\?\.model/);
  assert.match(
    workerSource,
    /session\.outputNames\?\.includes\?\.\("output0"\)/,
  );
  assert.match(
    workerSource,
    /selectiveOutput\.session\.run\([\s\S]*?\["output0"\]/,
  );
});

test("filters unused classes before allocation-stable NMS", () => {
  const filterIndex = workerSource.indexOf("RELEVANT_LAYOUT_TYPES.has(type)");
  const allocationIndex = workerSource.indexOf("detections.push({");
  assert.ok(filterIndex >= 0 && filterIndex < allocationIndex);
  const nmsSource = workerSource.slice(
    workerSource.indexOf("function nonMaxSuppression"),
    workerSource.indexOf("function computeIntersectionOverUnion"),
  );
  assert.doesNotMatch(nmsSource, /\.(?:shift|splice)\(/);
  assert.match(nmsSource, /new Uint8Array\(sorted\.length\)/);
});

test("closes decoded image bitmaps and reports worker stages", () => {
  assert.match(workerSource, /bitmap\.close\?\.\(\)/);
  for (const stage of [
    "queueMs",
    "decodeMs",
    "preprocessMs",
    "inferenceMs",
    "postprocessMs",
  ]) {
    assert.match(workerSource, new RegExp(stage));
  }
});
