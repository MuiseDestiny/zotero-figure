import * as assert from "node:assert/strict";
import test from "node:test";
import { mapLayoutElementsToPdf } from "../src/domain/pdfCoordinates";
import type { LayoutElement } from "../src/domain/layout";

const element: LayoutElement = {
  score: 0.9,
  type: "figure",
  xyxy: [0.1, 0.2, 0.4, 0.5],
};

test("preserves normalized detections on an unrotated offset CropBox", () => {
  const [mapped] = mapLayoutElementsToPdf([element], {
    pageBounds: [0, 0, 612, 792],
    pageToPdf: [1, 0, 0, -1, 10, 812],
    viewBox: [10, 20, 622, 812],
  });

  assertRectClose(mapped.xyxy, [0.1, 0.2, 0.4, 0.5]);
});

test("maps a rotated page detection back into Zotero PDF coordinates", () => {
  const [mapped] = mapLayoutElementsToPdf([element], {
    pageBounds: [0, 0, 792, 612],
    pageToPdf: [0, 1, 1, 0, 10, 20],
    viewBox: [10, 20, 622, 812],
  });

  assertRectClose(mapped.xyxy, [0.2, 0.6, 0.5, 0.9]);
});

function assertRectClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-10,
      `${value} differs from ${expected[index]}`,
    );
  });
}
