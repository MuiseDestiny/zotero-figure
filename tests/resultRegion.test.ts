import * as assert from "node:assert/strict";
import test from "node:test";
import { resizeNormalizedResultRegion } from "../src/domain/resultRegion";

test("moves a corrected region without leaving the page", () => {
  assertRectClose(
    resizeNormalizedResultRegion([0.2, 0.3, 0.6, 0.7], "move", 0.7, -0.5),
    [0.6, 0, 1, 0.4],
  );
});

test("resizes corrected region corners with a stable minimum size", () => {
  assertRectClose(
    resizeNormalizedResultRegion([0.2, 0.3, 0.6, 0.7], "nw", -0.4, -0.5),
    [0, 0, 0.6, 0.7],
  );
  assertRectClose(
    resizeNormalizedResultRegion([0.2, 0.3, 0.6, 0.7], "se", 0.8, 0.8),
    [0.2, 0.3, 1, 1],
  );
  assertRectClose(
    resizeNormalizedResultRegion([0.2, 0.3, 0.6, 0.7], "nw", 1, 1),
    [0.59, 0.69, 0.6, 0.7],
  );
});

function assertRectClose(actual: number[], expected: number[]): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-9);
  });
}
