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
