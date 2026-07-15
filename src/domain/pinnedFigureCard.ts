export interface Point {
  x: number;
  y: number;
}

export interface Size {
  height: number;
  width: number;
}

export interface PinnedCardTransform extends Point {
  scale: number;
}

export function clampPinnedCardTransform(
  transform: PinnedCardTransform,
  cardSize: Size,
  viewportSize: Size,
  margin: number,
): PinnedCardTransform {
  const safeMargin = Math.max(0, margin);
  const scale = Math.max(0, transform.scale);
  return {
    scale,
    x: clampPinnedCardAxis(
      transform.x,
      cardSize.width * scale,
      viewportSize.width,
      safeMargin,
    ),
    y: clampPinnedCardAxis(
      transform.y,
      cardSize.height * scale,
      viewportSize.height,
      safeMargin,
    ),
  };
}

export function zoomPinnedCardAtPoint(
  transform: PinnedCardTransform,
  nextScale: number,
  point: Point,
): PinnedCardTransform {
  if (transform.scale <= 0 || nextScale <= 0) return transform;
  const scaleRatio = nextScale / transform.scale;
  return {
    scale: nextScale,
    x: point.x - (point.x - transform.x) * scaleRatio,
    y: point.y - (point.y - transform.y) * scaleRatio,
  };
}

export function interpolatePinnedCardTransform(
  current: PinnedCardTransform,
  target: PinnedCardTransform,
  progress: number,
): PinnedCardTransform {
  const amount = Math.min(1, Math.max(0, progress));
  return {
    scale: current.scale + (target.scale - current.scale) * amount,
    x: current.x + (target.x - current.x) * amount,
    y: current.y + (target.y - current.y) * amount,
  };
}

export function getPinnedCardSmoothingProgress(
  elapsedMilliseconds: number,
  timeConstantMilliseconds: number,
): number {
  if (elapsedMilliseconds <= 0) return 0;
  if (timeConstantMilliseconds <= 0) return 1;
  return 1 - Math.exp(-elapsedMilliseconds / timeConstantMilliseconds);
}

function clampPinnedCardAxis(
  position: number,
  scaledCardSize: number,
  viewportSize: number,
  margin: number,
): number {
  const leadingEdge = margin;
  const trailingEdge = viewportSize - scaledCardSize - margin;
  const minimum = Math.min(leadingEdge, trailingEdge);
  const maximum = Math.max(leadingEdge, trailingEdge);
  return Math.min(maximum, Math.max(minimum, position));
}
