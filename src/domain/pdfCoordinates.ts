import type { LayoutElement, Rect } from "./layout";

export type PdfMatrix = [number, number, number, number, number, number];

export interface PdfPageGeometry {
  pageBounds: Rect;
  pageToPdf: PdfMatrix;
  viewBox: Rect;
}

export function mapLayoutElementsToPdf(
  elements: readonly LayoutElement[],
  geometry: PdfPageGeometry,
): LayoutElement[] {
  const { pageBounds, pageToPdf, viewBox } = geometry;
  const pageWidth = pageBounds[2] - pageBounds[0];
  const pageHeight = pageBounds[3] - pageBounds[1];
  const pdfWidth = viewBox[2] - viewBox[0];
  const pdfHeight = viewBox[3] - viewBox[1];
  assertPositiveDimension(pageWidth, "page width");
  assertPositiveDimension(pageHeight, "page height");
  assertPositiveDimension(pdfWidth, "PDF width");
  assertPositiveDimension(pdfHeight, "PDF height");

  return elements.map((element) => {
    const pageRect: Rect = [
      pageBounds[0] + element.xyxy[0] * pageWidth,
      pageBounds[1] + element.xyxy[1] * pageHeight,
      pageBounds[0] + element.xyxy[2] * pageWidth,
      pageBounds[1] + element.xyxy[3] * pageHeight,
    ];
    const pdfRect = transformRect(pageRect, pageToPdf);
    return {
      ...element,
      xyxy: [
        clampUnit((pdfRect[0] - viewBox[0]) / pdfWidth),
        clampUnit(1 - (pdfRect[3] - viewBox[1]) / pdfHeight),
        clampUnit((pdfRect[2] - viewBox[0]) / pdfWidth),
        clampUnit(1 - (pdfRect[1] - viewBox[1]) / pdfHeight),
      ],
    };
  });
}

export function transformRect(rect: Rect, matrix: PdfMatrix): Rect {
  const points = [
    transformPoint(rect[0], rect[1], matrix),
    transformPoint(rect[2], rect[1], matrix),
    transformPoint(rect[0], rect[3], matrix),
    transformPoint(rect[2], rect[3], matrix),
  ];
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function transformPoint(
  x: number,
  y: number,
  matrix: PdfMatrix,
): [number, number] {
  return [
    x * matrix[0] + y * matrix[2] + matrix[4],
    x * matrix[1] + y * matrix[3] + matrix[5],
  ];
}

function assertPositiveDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
