import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(
  "addon/chrome/content/yolo-worker.js",
  "utf8",
);

test("keeps detection input fixed with one thread per pool worker", () => {
  assert.match(workerSource, /const MODEL_SIZE = 640/);
  assert.match(workerSource, /const INFERENCE_THREADS = 1/);
  assert.match(workerSource, /return INFERENCE_THREADS/);
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
  for (const type of [
    "figure",
    "figure_caption",
    "table",
    "table_caption",
    "table_footnote",
    "isolate_formula",
    "formula_caption",
  ]) {
    assert.match(workerSource, new RegExp(`"${type}"`));
  }
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
