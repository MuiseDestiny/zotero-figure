import type { PdfCharacter, Rect } from "../../domain/layout";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";

export type PdfReader = _ZoteroTypes.ReaderInstance<"pdf">;

export interface PdfPageData {
  chars: PdfCharacter[];
  viewBox: Rect;
}

const READER_READY_TIMEOUT_MS = 30_000;
export const DETECTION_PAGE_RENDER_MAX_DIMENSION = 640;
export const PREVIEW_PAGE_RENDER_MAX_SCALE = 4;
export const PREVIEW_PAGE_RENDER_MAX_PIXELS = 12_000_000;
export const PREVIEW_PAGE_RENDER_MAX_DIMENSION = 8_192;

export interface RenderedPageCrops {
  cropEncodingMs: number;
  failedIndices: number[];
  images: Array<ArrayBuffer | undefined>;
  pageRenderMs: number;
  pixelCount: number;
  scale: number;
}

export async function getPdfReader(
  itemID: number,
  focus = false,
): Promise<PdfReader> {
  const tab = Zotero_Tabs._tabs.find(
    (candidate) =>
      (candidate.type === "reader" || candidate.type === "reader-unloaded") &&
      candidate.data.itemID === itemID,
  );

  let reader: PdfReader | undefined;
  if (tab?.type === "reader-unloaded") {
    Zotero_Tabs.close(tab.id);
  } else if (tab?.type === "reader") {
    reader = Zotero.Reader.getByTabID(tab.id) as PdfReader | undefined;
  }

  reader ??= (await Zotero.Reader.open(itemID, undefined, {
    openInBackground: !focus,
  })) as PdfReader | undefined;

  if (!reader) throw new Error(`Unable to open PDF reader for item ${itemID}`);
  await waitForPdfDocument(reader);
  return reader;
}

export function getPageCount(reader: PdfReader): number {
  const pdfWindow = reader._internalReader._lastView._iframeWindow;
  const count = pdfWindow?.PDFViewerApplication?.pagesCount;
  if (!count) throw new Error("The PDF document is not ready");
  return count;
}

export async function getPageData(
  reader: PdfReader,
  pageIndex: number,
): Promise<PdfPageData> {
  const pdfWindow = reader._internalReader._lastView._iframeWindow;
  if (!pdfWindow) throw new Error("The PDF reader window is unavailable");

  return (await pdfWindow.eval(`
    PDFViewerApplication.pdfDocument._transport.messageHandler.sendWithPromise(
      "GetPageData",
      { pageIndex: ${JSON.stringify(pageIndex)} }
    )
  `)) as PdfPageData;
}

export async function renderPageImage(
  reader: PdfReader,
  pageIndex: number,
  viewBox: Rect,
): Promise<ArrayBuffer> {
  const pdfWindow = reader._internalReader._lastView._iframeWindow;
  if (!pdfWindow) throw new Error("The PDF reader window is unavailable");

  const scale = getPageRenderScale(viewBox);
  const image = (await pdfWindow.eval(`
    (async () => {
      const page = await PDFViewerApplication.pdfDocument.getPage(
        ${JSON.stringify(pageIndex + 1)}
      );
      const viewport = page.getViewport({ scale: ${JSON.stringify(scale)} });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));
      const offscreen = typeof OffscreenCanvas !== "undefined";
      const canvas = offscreen
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
      try {
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Unable to create PDF render canvas");
        await page.render({ canvasContext: context, viewport }).promise;

        const blob = offscreen
          ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 })
          : await new Promise((resolve, reject) => {
              canvas.toBlob(
                (value) => value
                  ? resolve(value)
                  : reject(new Error("Unable to encode rendered PDF page")),
                "image/jpeg",
                0.9,
              );
            });
        return blob.arrayBuffer();
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    })()
  `)) as ArrayBuffer;
  if (!image || typeof image.byteLength !== "number" || image.byteLength < 1) {
    throw new Error(`Failed to render PDF page ${pageIndex + 1}`);
  }
  return image;
}

/**
 * Render one bounded high-resolution page and crop every result from that
 * shared canvas. This avoids invoking Zotero's annotation renderer, which
 * rerenders the complete PDF page once for every crop.
 */
export async function renderPageImageCrops(
  reader: PdfReader,
  pageIndex: number,
  viewBox: Rect,
  rects: readonly Rect[],
  signal?: AbortSignal,
): Promise<RenderedPageCrops> {
  if (rects.length === 0) {
    return {
      cropEncodingMs: 0,
      failedIndices: [],
      images: [],
      pageRenderMs: 0,
      pixelCount: 0,
      scale: 0,
    };
  }
  throwIfAborted(signal);
  validateViewBox(viewBox);
  for (const rect of rects) validateRect(rect);

  const pdfWindow = reader._internalReader._lastView._iframeWindow;
  if (!pdfWindow) throw new Error("The PDF reader window is unavailable");
  const scale = getPreviewPageRenderScale(viewBox);
  const jobID = `zoterofigure-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const payload = JSON.stringify({
    jobID,
    maxDimension: PREVIEW_PAGE_RENDER_MAX_DIMENSION,
    maxPixels: PREVIEW_PAGE_RENDER_MAX_PIXELS,
    pageIndex,
    rects,
    scale,
  });
  const evaluation = pdfWindow.eval(`
    (async () => {
      const input = ${payload};
      const jobs = globalThis.__zoteroFigureRenderJobs ??=
        new Map();
      const job = { cancelled: false, renderTask: undefined };
      jobs.set(input.jobID, job);
      let pageCanvas;
      try {
        const page = await PDFViewerApplication.pdfDocument.getPage(
          input.pageIndex + 1
        );
        const baseViewport = page.getViewport({ scale: 1 });
        const boundedScale = Math.min(
          input.scale,
          Math.sqrt(
            input.maxPixels / (baseViewport.width * baseViewport.height)
          ),
          input.maxDimension /
            Math.max(baseViewport.width, baseViewport.height)
        );
        if (!Number.isFinite(boundedScale) || boundedScale <= 0) {
          throw new Error("PDF preview scale is invalid");
        }
        const viewport = page.getViewport({ scale: boundedScale });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        const offscreen = typeof OffscreenCanvas !== "undefined";
        pageCanvas = offscreen
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
        pageCanvas.width = width;
        pageCanvas.height = height;
        const context = pageCanvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Unable to create PDF preview canvas");

        const pageRenderStartedAt = performance.now();
        job.renderTask = page.render({ canvasContext: context, viewport });
        if (job.cancelled) job.renderTask.cancel();
        await job.renderTask.promise;
        const pageRenderMs = performance.now() - pageRenderStartedAt;
        const images = [];
        const failedIndices = [];
        let cropEncodingMs = 0;

        for (let index = 0; index < input.rects.length; index++) {
          if (job.cancelled) throw new Error("Figure preview render cancelled");
          const rect = input.rects[index];
          let cropCanvas;
          try {
            const viewportRect = viewport.convertToViewportRectangle(rect);
            const left = Math.max(
              0,
              Math.floor(Math.min(viewportRect[0], viewportRect[2]))
            );
            const top = Math.max(
              0,
              Math.floor(Math.min(viewportRect[1], viewportRect[3]))
            );
            const right = Math.min(
              width,
              Math.ceil(Math.max(viewportRect[0], viewportRect[2]))
            );
            const bottom = Math.min(
              height,
              Math.ceil(Math.max(viewportRect[1], viewportRect[3]))
            );
            const cropWidth = Math.max(1, right - left);
            const cropHeight = Math.max(1, bottom - top);
            cropCanvas = offscreen
              ? new OffscreenCanvas(cropWidth, cropHeight)
              : document.createElement("canvas");
            cropCanvas.width = cropWidth;
            cropCanvas.height = cropHeight;
            const cropContext = cropCanvas.getContext("2d", { alpha: false });
            if (!cropContext) {
              throw new Error("Unable to create figure crop canvas");
            }
            cropContext.drawImage(
              pageCanvas,
              left,
              top,
              cropWidth,
              cropHeight,
              0,
              0,
              cropWidth,
              cropHeight
            );
            const cropStartedAt = performance.now();
            const blob = offscreen
              ? await cropCanvas.convertToBlob({ type: "image/png" })
              : await new Promise((resolve, reject) => {
                  cropCanvas.toBlob(
                    (value) => value
                      ? resolve(value)
                      : reject(new Error("Unable to encode figure crop")),
                    "image/png"
                  );
                });
            images.push(await blob.arrayBuffer());
            cropEncodingMs += performance.now() - cropStartedAt;
          } catch (error) {
            images.push(null);
            failedIndices.push(index);
          } finally {
            if (cropCanvas) {
              cropCanvas.width = 0;
              cropCanvas.height = 0;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        return {
          cropEncodingMs,
          failedIndices,
          images,
          pageRenderMs,
          pixelCount: width * height,
          scale: boundedScale,
        };
      } finally {
        jobs.delete(input.jobID);
        if (pageCanvas) {
          pageCanvas.width = 0;
          pageCanvas.height = 0;
        }
      }
    })()
  `) as Promise<{
    cropEncodingMs: number;
    failedIndices: number[];
    images: Array<ArrayBuffer | null>;
    pageRenderMs: number;
    pixelCount: number;
    scale: number;
  }>;

  const cancel = () => {
    void Promise.resolve(
      pdfWindow.eval(`
        (() => {
          const job = globalThis.__zoteroFigureRenderJobs?.get(
            ${JSON.stringify(jobID)}
          );
          if (!job) return;
          job.cancelled = true;
          job.renderTask?.cancel();
        })()
      `),
    ).catch((error) => Zotero.logError(toError(error)));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const rendered = await evaluation;
    throwIfAborted(signal);
    return {
      ...rendered,
      images: rendered.images.map((image) =>
        image && image.byteLength > 0 ? image : undefined,
      ),
    };
  } catch (error) {
    if (signal?.aborted) throw new OperationCancelledError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export function getPageRenderScale(
  viewBox: Rect,
  maxDimension = DETECTION_PAGE_RENDER_MAX_DIMENSION,
): number {
  const width = Math.abs(viewBox[2] - viewBox[0]);
  const height = Math.abs(viewBox[3] - viewBox[1]);
  const longestSide = Math.max(width, height);
  if (!Number.isFinite(longestSide) || longestSide <= 0) {
    throw new Error("PDF page has invalid dimensions");
  }
  return maxDimension / longestSide;
}

export function getPreviewPageRenderScale(viewBox: Rect): number {
  const [left, bottom, right, top] = validateViewBox(viewBox);
  const width = right - left;
  const height = top - bottom;
  const pixelScale = Math.sqrt(
    PREVIEW_PAGE_RENDER_MAX_PIXELS / (width * height),
  );
  const dimensionScale =
    PREVIEW_PAGE_RENDER_MAX_DIMENSION / Math.max(width, height);
  return Math.min(PREVIEW_PAGE_RENDER_MAX_SCALE, pixelScale, dimensionScale);
}

function validateViewBox(viewBox: Rect): Rect {
  validateRect(viewBox, "PDF page has invalid dimensions");
  return viewBox;
}

function validateRect(rect: Rect, message = "PDF crop has invalid dimensions") {
  if (
    !rect.every(Number.isFinite) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  ) {
    throw new Error(message);
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function waitForPdfDocument(reader: PdfReader): Promise<void> {
  const startedAt = Date.now();
  while (
    !reader._internalReader._lastView._iframeWindow?.PDFViewerApplication
      ?.pdfDocument
  ) {
    if (Date.now() - startedAt > READER_READY_TIMEOUT_MS) {
      throw new Error("Timed out while waiting for the PDF reader");
    }
    await Zotero.Promise.delay(100);
  }
}
