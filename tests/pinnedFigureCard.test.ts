import * as assert from "node:assert/strict";
import test from "node:test";
import {
  clampPinnedCardTransform,
  getPinnedCardSmoothingProgress,
  interpolatePinnedCardTransform,
  zoomPinnedCardAtPoint,
} from "../src/domain/pinnedFigureCard";

test("keeps a pinned card inside the viewport when it fits", () => {
  assert.deepEqual(
    clampPinnedCardTransform(
      { scale: 1, x: 900, y: -20 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ),
    { scale: 1, x: 488, y: 12 },
  );
});

test("interpolates pinned card transforms without overshooting", () => {
  assert.deepEqual(
    interpolatePinnedCardTransform(
      { scale: 1, x: 20, y: 40 },
      { scale: 2, x: 120, y: 240 },
      0.25,
    ),
    { scale: 1.25, x: 45, y: 90 },
  );
  assert.deepEqual(
    interpolatePinnedCardTransform(
      { scale: 1, x: 20, y: 40 },
      { scale: 2, x: 120, y: 240 },
      2,
    ),
    { scale: 2, x: 120, y: 240 },
  );
});

test("keeps zoom smoothing consistent across different frame rates", () => {
  const fullInterval = getPinnedCardSmoothingProgress(100, 55);
  const quarterInterval = getPinnedCardSmoothingProgress(25, 55);
  const fourQuarterIntervals = 1 - (1 - quarterInterval) ** 4;

  assert.ok(Math.abs(fullInterval - fourQuarterIntervals) < 1e-12);
  assert.equal(getPinnedCardSmoothingProgress(0, 55), 0);
  assert.equal(getPinnedCardSmoothingProgress(10, 0), 1);
});

test("allows both edges of an oversized pinned card to be reached", () => {
  assert.equal(
    clampPinnedCardTransform(
      { scale: 3, x: -2_000, y: 0 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ).x,
    -112,
  );
  assert.equal(
    clampPinnedCardTransform(
      { scale: 3, x: 2_000, y: 0 },
      { height: 200, width: 300 },
      { height: 600, width: 800 },
      12,
    ).x,
    12,
  );
});

test("zooms around the pointer without moving its card-local position", () => {
  const current = { scale: 1, x: 100, y: 80 };
  const point = { x: 250, y: 180 };
  const zoomed = zoomPinnedCardAtPoint(current, 2, point);

  assert.deepEqual(zoomed, { scale: 2, x: -50, y: -20 });
  assert.equal((point.x - current.x) / current.scale, 150);
  assert.equal((point.x - zoomed.x) / zoomed.scale, 150);
  assert.equal((point.y - current.y) / current.scale, 100);
  assert.equal((point.y - zoomed.y) / zoomed.scale, 100);
});
