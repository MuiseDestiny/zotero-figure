import type { Rect } from "../../domain/layout";
import { throwIfAborted } from "../../utils/cancellation";

/**
 * Compatibility fallback when Zotero's coordinate image renderer is not
 * available. The normal path stores a fresh high-resolution PDF crop.
 */
export async function cropPageImage(
  image: ArrayBuffer,
  viewBox: Rect,
  rects: readonly Rect[],
  signal?: AbortSignal,
): Promise<ArrayBuffer[]> {
  if (rects.length === 0) return [];
  throwIfAborted(signal);
  if (typeof createImageBitmap !== "function") {
    throw new Error("Image decoding is unavailable in this Zotero window");
  }
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("Canvas encoding is unavailable in this Zotero window");
  }

  const bitmap = await createImageBitmap(
    new Blob([image], { type: "image/jpeg" }),
  );
  try {
    const pageWidth = viewBox[2] - viewBox[0];
    const pageHeight = viewBox[3] - viewBox[1];
    if (pageWidth <= 0 || pageHeight <= 0) {
      throw new Error("PDF page has invalid dimensions");
    }
    const scaleX = bitmap.width / pageWidth;
    const scaleY = bitmap.height / pageHeight;
    const results: ArrayBuffer[] = [];

    for (const rect of rects) {
      throwIfAborted(signal);
      const sourceLeft = clamp(
        (rect[0] - viewBox[0]) * scaleX,
        0,
        bitmap.width,
      );
      const sourceTop = clamp(
        (viewBox[3] - rect[3]) * scaleY,
        0,
        bitmap.height,
      );
      const sourceRight = clamp(
        (rect[2] - viewBox[0]) * scaleX,
        0,
        bitmap.width,
      );
      const sourceBottom = clamp(
        (viewBox[3] - rect[1]) * scaleY,
        0,
        bitmap.height,
      );
      const sourceWidth = Math.max(1, Math.round(sourceRight - sourceLeft));
      const sourceHeight = Math.max(1, Math.round(sourceBottom - sourceTop));
      const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Unable to create figure crop canvas");
      context.drawImage(
        bitmap,
        sourceLeft,
        sourceTop,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      results.push(await blob.arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;
    }

    return results;
  } finally {
    bitmap.close();
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
