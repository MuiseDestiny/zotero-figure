import type { PdfCharacter, Rect } from "../../domain/layout";
import type { PdfMatrix } from "../../domain/pdfCoordinates";

export interface PdfAnalysisPageData {
  chars: PdfCharacter[];
  pageBounds: Rect;
  pdfToPage: PdfMatrix;
  pageToPdf: PdfMatrix;
  viewBox: Rect;
}

export interface PdfDetectionImage {
  encodeMs: number;
  image: ArrayBuffer;
  pixelCount: number;
  renderMs: number;
}

export interface PdfRegionImages {
  encodeMs: number;
  images: ArrayBuffer[];
  maxScale: number;
  pixelCount: number;
  renderMs: number;
}

export interface PdfAnalysisDocument {
  readonly pageCount: number;
  close(): Promise<void>;
  getPageData(
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisPageData>;
  renderDetectionImage(
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfDetectionImage>;
  renderRegions(
    pageIndex: number,
    rects: readonly Rect[],
    signal?: AbortSignal,
  ): Promise<PdfRegionImages>;
}

export interface PdfEngine {
  dispose(): void;
  open(
    attachment: Zotero.Item,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisDocument>;
  prepare(signal?: AbortSignal): Promise<void>;
}
