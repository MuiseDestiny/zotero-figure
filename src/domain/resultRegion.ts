import type { Rect } from "./layout";

export type ResultRegionEditMode = "move" | "ne" | "nw" | "se" | "sw";

const MINIMUM_REGION_SIZE = 0.01;

export function resizeNormalizedResultRegion(
  start: Rect,
  mode: ResultRegionEditMode,
  deltaX: number,
  deltaY: number,
): Rect {
  if (mode === "move") {
    const width = start[2] - start[0];
    const height = start[3] - start[1];
    const left = clamp(start[0] + deltaX, 0, 1 - width);
    const top = clamp(start[1] + deltaY, 0, 1 - height);
    return [left, top, left + width, top + height];
  }

  let [left, top, right, bottom] = start;
  if (mode.includes("w")) {
    left = clamp(start[0] + deltaX, 0, right - MINIMUM_REGION_SIZE);
  } else {
    right = clamp(start[2] + deltaX, left + MINIMUM_REGION_SIZE, 1);
  }
  if (mode.includes("n")) {
    top = clamp(start[1] + deltaY, 0, bottom - MINIMUM_REGION_SIZE);
  } else {
    bottom = clamp(start[3] + deltaY, top + MINIMUM_REGION_SIZE, 1);
  }
  return [left, top, right, bottom];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
