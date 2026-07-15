import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(
  "addon/chrome/content/mupdf-worker.js",
  "utf8",
);

test("bounds MuPDF detection and direct region rendering", () => {
  assert.match(workerSource, /const DETECTION_MAX_DIMENSION = 640/);
  assert.match(workerSource, /const REGION_TARGET_DIMENSION = 2400/);
  assert.match(workerSource, /const REGION_MAX_SCALE = 6/);
  assert.match(workerSource, /const REGION_MAX_PIXELS = 8_000_000/);
  assert.match(workerSource, /page\.toDisplayList\(false\)/);
  assert.match(workerSource, /new mupdf\.Pixmap\(/);
});

test("applies the region scale exactly once", () => {
  assert.match(
    workerSource,
    /new mupdf\.DrawDevice\(mupdf\.Matrix\.identity, pixmap\)/,
  );
  assert.match(
    workerSource,
    /displayList\.run\(device, mupdf\.Matrix\.scale\(scale, scale\)\)/,
  );
});

test("releases the MuPDF store only after the last document closes", () => {
  assert.match(workerSource, /import mupdf, \{ emptyStore \}/);
  assert.match(workerSource, /if \(documents\.size === 0\) emptyStore\(\)/);
  assert.doesNotMatch(workerSource, /mupdf\.emptyStore\(\)/);
});
