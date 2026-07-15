import type { Rect } from "../../domain/layout";
import { bytesToDataURL } from "../../utils/dataURL";
import type { PdfReader } from "./reader";

const IMAGE_COLOR = "#eee";

interface ReaderImageRendererCompat {
  _renderAnnotationImage(annotation: unknown): Promise<unknown>;
}

interface ReaderViewCompat {
  _pdfRenderer?: ReaderImageRendererCompat;
}

interface ReaderInternalsCompat {
  _lastView?: ReaderViewCompat;
  _primaryView?: object;
}

interface ComponentsCompat {
  utils?: {
    cloneInto<T>(value: T, target: object): T;
  };
}

export interface ReaderImageCrop {
  pageIndex: number;
  rect: Rect;
}

/** Render a coordinate crop at Zotero's native image-annotation scale. */
export async function renderReaderImageCrop(
  reader: PdfReader,
  crop: ReaderImageCrop,
): Promise<string> {
  const annotation = createImageAnnotation(crop);
  const internals = reader._internalReader as unknown as ReaderInternalsCompat;
  const renderer = internals._lastView?._pdfRenderer;
  if (!renderer) {
    throw new Error("Zotero's PDF image renderer is unavailable");
  }

  const rendered = await renderer._renderAnnotationImage(
    cloneIntoReaderView(annotation, internals._primaryView),
  );
  if (!isPNGDataURL(rendered)) {
    throw new Error("Zotero did not return a PNG image for the selected crop");
  }
  return rendered;
}

export async function renderReaderImageCropBytes(
  reader: PdfReader,
  crop: ReaderImageCrop,
): Promise<ArrayBuffer> {
  return decodePNGDataURL(await renderReaderImageCrop(reader, crop));
}

/** Use the shared local MuPDF result; retain the Reader renderer for recovery. */
export async function getReaderImageCropDataURL(
  reader: PdfReader,
  crop: ReaderImageCrop,
  fallbackImagePath: string,
): Promise<string> {
  try {
    return await readLocalImageDataURL(fallbackImagePath);
  } catch (localError) {
    try {
      return await renderReaderImageCrop(reader, crop);
    } catch (renderError) {
      throw new Error(
        `Unable to prepare the figure image: ${toError(localError).message}; Reader fallback: ${toError(renderError).message}`,
      );
    }
  }
}

export async function readLocalImageDataURL(path: string): Promise<string> {
  const bytes = await IOUtils.read(path);
  return bytesToDataURL(bytes, "image/png");
}

function createImageAnnotation(crop: ReaderImageCrop): {
  color: string;
  position: { pageIndex: number; rects: [Rect] };
} {
  const rect = validateCrop(crop);
  return {
    color: IMAGE_COLOR,
    position: {
      pageIndex: crop.pageIndex,
      rects: [rect],
    },
  };
}

function validateCrop(crop: ReaderImageCrop): Rect {
  if (!Number.isInteger(crop.pageIndex) || crop.pageIndex < 0) {
    throw new Error("Figure image has an invalid PDF page index");
  }
  const [left, bottom, right, top] = crop.rect;
  if (
    ![left, bottom, right, top].every(Number.isFinite) ||
    right <= left ||
    top <= bottom
  ) {
    throw new Error("Figure image has an invalid PDF crop rectangle");
  }
  return [left, bottom, right, top];
}

function cloneIntoReaderView<T>(value: T, target: object | undefined): T {
  const cloneInto = (
    globalThis as typeof globalThis & { Components?: ComponentsCompat }
  ).Components?.utils?.cloneInto;
  if (!cloneInto || !target) return value;
  return cloneInto(value, target);
}

function isPNGDataURL(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/png;base64,/i.test(value);
}

function decodePNGDataURL(dataURL: string): ArrayBuffer {
  const separator = dataURL.indexOf(",");
  if (separator < 0) throw new Error("PNG data URL has no encoded payload");
  const binary = atob(dataURL.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
