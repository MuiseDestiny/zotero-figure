import mupdf, { emptyStore } from "./mupdf/mupdf.js";

const DETECTION_MAX_DIMENSION = 640;
const DETECTION_JPEG_QUALITY = 85;
const REGION_TARGET_DIMENSION = 2400;
const REGION_MAX_SCALE = 6;
const REGION_MAX_PIXELS = 8_000_000;
const documents = new Map();

self.onmessage = (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "OPEN_DOCUMENT":
        openDocument(message);
        break;
      case "CLOSE_DOCUMENT":
        closeDocument(message);
        break;
      case "GET_PAGE_DATA":
        getPageData(message);
        break;
      case "RENDER_DETECTION":
        renderDetection(message);
        break;
      case "RENDER_REGIONS":
        renderRegions(message);
        break;
      default:
        throw new Error(`Unsupported MuPDF request: ${message.type}`);
    }
  } catch (error) {
    self.postMessage({
      error: getErrorMessage(error),
      requestID: message.requestID,
      type: "ERROR",
    });
  }
};

self.postMessage({ type: "READY" });

function openDocument(message) {
  const { documentID, pdfData, requestID } = message;
  if (!Number.isInteger(documentID) || documents.has(documentID)) {
    throw new Error("Invalid or duplicate MuPDF document ID");
  }
  if (!(pdfData instanceof ArrayBuffer) || pdfData.byteLength < 5) {
    throw new Error("Invalid PDF attachment data");
  }
  const document = mupdf.Document.openDocument(pdfData, "application/pdf");
  try {
    if (document.needsPassword()) {
      throw new Error("Password-protected PDFs are not supported");
    }
    const pageCount = document.countPages();
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error("The PDF contains no pages");
    }
    documents.set(documentID, document);
    self.postMessage({ documentID, pageCount, requestID, type: "RESULT" });
  } catch (error) {
    document.destroy();
    throw error;
  }
}

function closeDocument(message) {
  const { documentID, requestID } = message;
  const document = documents.get(documentID);
  documents.delete(documentID);
  document?.destroy();
  if (documents.size === 0) emptyStore();
  self.postMessage({ requestID, type: "RESULT" });
}

function getPageData(message) {
  const { documentID, pageIndex, requestID } = message;
  const document = getDocument(documentID);
  const page = loadPage(document, pageIndex);
  let structuredText;
  try {
    const geometry = getPageGeometry(page);
    structuredText = page.toStructuredText("preserve-whitespace");
    const chars = extractCharacters(structuredText, geometry.pageToPdf);
    self.postMessage({
      requestID,
      result: { chars, ...geometry },
      type: "RESULT",
    });
  } finally {
    structuredText?.destroy();
    page.destroy();
  }
}

function renderDetection(message) {
  const { documentID, pageIndex, requestID } = message;
  const document = getDocument(documentID);
  const page = loadPage(document, pageIndex);
  let pixmap;
  try {
    const bounds = page.getBounds();
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    validateDimensions(width, height);
    const scale = DETECTION_MAX_DIMENSION / Math.max(width, height);
    const renderStartedAt = now();
    pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      false,
      "View",
      "CropBox",
    );
    const renderMs = elapsed(renderStartedAt);
    const encodeStartedAt = now();
    const image = copyEncodedBytes(pixmap.asJPEG(DETECTION_JPEG_QUALITY));
    const encodeMs = elapsed(encodeStartedAt);
    const pixelCount = pixmap.getWidth() * pixmap.getHeight();
    self.postMessage(
      {
        requestID,
        result: { encodeMs, image, pixelCount, renderMs },
        type: "RESULT",
      },
      [image],
    );
  } finally {
    pixmap?.destroy();
    page.destroy();
  }
}

function renderRegions(message) {
  const { documentID, pageIndex, rects, requestID } = message;
  if (!Array.isArray(rects)) throw new Error("Invalid PDF region list");
  const document = getDocument(documentID);
  const page = loadPage(document, pageIndex);
  let displayList;
  const images = [];
  const transfers = [];
  let encodeMs = 0;
  let maxScale = 0;
  let pixelCount = 0;
  let renderMs = 0;
  try {
    const geometry = getPageGeometry(page);
    const displayListStartedAt = now();
    displayList = page.toDisplayList(false);
    renderMs += elapsed(displayListStartedAt);

    for (const inputRect of rects) {
      const pdfRect = validateRect(inputRect);
      const pageRect = intersectRects(
        transformRect(pdfRect, geometry.pdfToPage),
        geometry.pageBounds,
      );
      const width = pageRect[2] - pageRect[0];
      const height = pageRect[3] - pageRect[1];
      validateDimensions(width, height);
      const scale = getRegionScale(width, height);
      maxScale = Math.max(maxScale, scale);
      const bbox = [
        Math.floor(pageRect[0] * scale),
        Math.floor(pageRect[1] * scale),
        Math.ceil(pageRect[2] * scale),
        Math.ceil(pageRect[3] * scale),
      ];
      let device;
      let pixmap;
      try {
        pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
        pixmap.clear(255);
        device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
        const renderStartedAt = now();
        displayList.run(device, mupdf.Matrix.scale(scale, scale));
        device.close();
        renderMs += elapsed(renderStartedAt);
        pixelCount = Math.max(
          pixelCount,
          pixmap.getWidth() * pixmap.getHeight(),
        );
        const encodeStartedAt = now();
        const image = copyEncodedBytes(pixmap.asPNG());
        encodeMs += elapsed(encodeStartedAt);
        images.push(image);
        transfers.push(image);
      } finally {
        device?.destroy();
        pixmap?.destroy();
      }
    }

    self.postMessage(
      {
        requestID,
        result: { encodeMs, images, maxScale, pixelCount, renderMs },
        type: "RESULT",
      },
      transfers,
    );
  } finally {
    displayList?.destroy();
    page.destroy();
  }
}

function getPageGeometry(page) {
  const pageBounds = validateRect(page.getBounds());
  const pdfToPage = page.getTransform();
  const pageToPdf = mupdf.Matrix.invert(pdfToPage);
  const viewBox = transformRect(pageBounds, pageToPdf);
  validateDimensions(viewBox[2] - viewBox[0], viewBox[3] - viewBox[1]);
  return { pageBounds, pageToPdf, pdfToPage, viewBox };
}

function extractCharacters(structuredText, pageToPdf) {
  const chars = [];
  let lineStart = 0;
  structuredText.walk({
    beginLine() {
      lineStart = chars.length;
    },
    onChar(character, _origin, _font, _size, quad) {
      if (typeof character !== "string" || !character) return;
      chars.push({
        c: character,
        rect: transformQuadBounds(quad, pageToPdf),
      });
    },
    endLine() {
      if (chars.length > lineStart) {
        chars[chars.length - 1].lineBreakAfter = true;
      }
    },
  });
  return chars;
}

function getDocument(documentID) {
  const document = documents.get(documentID);
  if (!document) throw new Error(`Unknown MuPDF document ${documentID}`);
  return document;
}

function loadPage(document, pageIndex) {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= document.countPages()
  ) {
    throw new RangeError(`Invalid PDF page index ${pageIndex}`);
  }
  const page = document.loadPage(pageIndex);
  if (typeof page.getTransform !== "function") {
    page.destroy();
    throw new Error("The attachment is not a supported PDF document");
  }
  return page;
}

function getRegionScale(width, height) {
  return Math.min(
    REGION_MAX_SCALE,
    REGION_TARGET_DIMENSION / Math.max(width, height),
    Math.sqrt(REGION_MAX_PIXELS / (width * height)),
  );
}

function transformQuadBounds(quad, matrix) {
  if (!Array.isArray(quad) || quad.length !== 8) {
    throw new Error("MuPDF returned an invalid character quad");
  }
  const points = [];
  for (let index = 0; index < quad.length; index += 2) {
    points.push(transformPoint(quad[index], quad[index + 1], matrix));
  }
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function transformRect(rect, matrix) {
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

function transformPoint(x, y, matrix) {
  return [
    x * matrix[0] + y * matrix[2] + matrix[4],
    x * matrix[1] + y * matrix[3] + matrix[5],
  ];
}

function intersectRects(first, second) {
  const rect = [
    Math.max(first[0], second[0]),
    Math.max(first[1], second[1]),
    Math.min(first[2], second[2]),
    Math.min(first[3], second[3]),
  ];
  validateDimensions(rect[2] - rect[0], rect[3] - rect[1]);
  return rect;
}

function validateRect(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite) ||
    value[2] <= value[0] ||
    value[3] <= value[1]
  ) {
    throw new Error("Invalid PDF rectangle");
  }
  return value;
}

function validateDimensions(width, height) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Invalid PDF page dimensions");
  }
}

function copyEncodedBytes(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function elapsed(startedAt) {
  return Math.max(0, now() - startedAt);
}

function now() {
  return self.performance?.now?.() ?? Date.now();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
