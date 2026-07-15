import * as assert from "node:assert/strict";
import test from "node:test";
import {
  DETECTION_PAGE_RENDER_MAX_DIMENSION,
  getPageRenderScale,
  getPreviewPageRenderScale,
  PREVIEW_PAGE_RENDER_MAX_DIMENSION,
  PREVIEW_PAGE_RENDER_MAX_PIXELS,
  PREVIEW_PAGE_RENDER_MAX_SCALE,
} from "../src/platform/zotero/reader";

test("renders detection pages directly at the 640px model resolution", () => {
  assert.equal(DETECTION_PAGE_RENDER_MAX_DIMENSION, 640);
  const scale = getPageRenderScale([0, 0, 612, 792]);
  assert.equal(Math.round(792 * scale), DETECTION_PAGE_RENDER_MAX_DIMENSION);
  assert.ok(612 * scale < DETECTION_PAGE_RENDER_MAX_DIMENSION);
});

test("rejects invalid PDF page dimensions", () => {
  assert.throws(() => getPageRenderScale([0, 0, 0, 0]), /invalid dimensions/);
  assert.throws(
    () => getPreviewPageRenderScale([0, 0, 0, 0]),
    /invalid dimensions/,
  );
});

test("bounds high-resolution previews by scale, pixels, and dimension", () => {
  assert.equal(getPreviewPageRenderScale([0, 0, 612, 792]), 4);

  const large = getPreviewPageRenderScale([0, 0, 4_000, 4_000]);
  assert.ok(large < PREVIEW_PAGE_RENDER_MAX_SCALE);
  assert.ok(4_000 * large <= PREVIEW_PAGE_RENDER_MAX_DIMENSION);
  assert.ok(4_000 * large * 4_000 * large <= PREVIEW_PAGE_RENDER_MAX_PIXELS);
});
