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
