import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const analyzerSource = readFileSync(
  "src/services/layout/layoutAnalyzer.ts",
  "utf8",
);

test("keeps each analysis stage within the documented memory budget", () => {
  assert.match(analyzerSource, /const MAX_SCHEDULED_PAGES = 3/);
  assert.match(analyzerSource, /const MAX_DETECTION_PAGES = 2/);
  assert.match(analyzerSource, /const MAX_PDF_RENDERS = 1/);
  assert.match(analyzerSource, /const MAX_PREVIEW_PAGES = 1/);
  assert.match(analyzerSource, /const MAX_STORAGE_PAGES = 1/);
  assert.match(analyzerSource, /const MAX_ANNOTATION_PAGES = 1/);
});
