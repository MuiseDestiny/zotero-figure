import type { FigureResultKind } from "./figureResults";
import type { Rect } from "./layout";

export interface FigureGalleryLibrary {
  id: number;
  name: string;
}

export interface FigureGalleryEntry {
  attachmentID: number;
  collectionIDs: number[];
  collectionNames: string[];
  comment: string;
  documentItemID: number;
  documentTitle: string;
  id: string;
  kind: FigureResultKind;
  latex?: string;
  libraryID: number;
  pageIndex: number;
  pageLabel: string;
  rect: Rect;
  tag: string;
  year: string;
}

export interface FigureGallerySnapshot {
  entries: FigureGalleryEntry[];
  generatedAt: string;
  libraryID: number;
}

export interface FigureGalleryImage {
  base64: string;
  mimeType: "image/png";
}

export interface FigureGalleryBootstrap {
  defaultLibraryID: number;
  libraries: FigureGalleryLibrary[];
}

export function extractFigureGalleryYear(date: string): string {
  return date.match(/(?:^|\D)((?:1[5-9]|20|21)\d{2})(?=\D|$)/)?.[1] ?? "";
}

export function getFigureGalleryImageAspectRatio(
  rect: Readonly<Rect>,
): number | undefined {
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return width / height;
}

export function getFigureGalleryColumnCount(
  availableWidth: number,
  minimumColumnWidth: number,
  gap: number,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  if (!Number.isFinite(minimumColumnWidth) || minimumColumnWidth <= 0) return 1;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return Math.max(
    1,
    Math.floor((availableWidth + safeGap) / (minimumColumnWidth + safeGap)),
  );
}

export function findShortestFigureGalleryColumn(
  heights: readonly number[],
): number {
  let shortestIndex = 0;
  let shortestHeight = Number.POSITIVE_INFINITY;
  for (let index = 0; index < heights.length; index++) {
    const height = Number.isFinite(heights[index])
      ? Math.max(0, heights[index])
      : Number.POSITIVE_INFINITY;
    if (height >= shortestHeight) continue;
    shortestHeight = height;
    shortestIndex = index;
  }
  return shortestIndex;
}
