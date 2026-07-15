import * as assert from "node:assert/strict";
import test from "node:test";
import {
  renderReaderImageCrop,
  renderReaderImageCropBytes,
  type ReaderImageCrop,
} from "../src/platform/zotero/readerImageRenderer";
import type { PdfReader } from "../src/platform/zotero/reader";

const PNG_DATA_URL = "data:image/png;base64,AAAA";

test("renders a result crop through Zotero's coordinate image renderer", async () => {
  let received: unknown;
  const primaryView = {};
  const reader = {
    _internalReader: {
      _lastView: {
        _pdfRenderer: {
          _renderAnnotationImage: async (annotation: unknown) => {
            received = annotation;
            return PNG_DATA_URL;
          },
        },
      },
      _primaryView: primaryView,
    },
  } as unknown as PdfReader;

  const crop: ReaderImageCrop = {
    pageIndex: 3,
    rect: [12, 24, 180, 260],
  };
  const result = await renderReaderImageCrop(reader, crop);

  assert.equal(result, PNG_DATA_URL);
  assert.deepEqual(received, {
    color: "#eee",
    position: {
      pageIndex: 3,
      rects: [[12, 24, 180, 260]],
    },
  });
});

test("decodes a rendered coordinate crop for local PNG storage", async () => {
  const reader = {
    _internalReader: {
      _lastView: {
        _pdfRenderer: {
          _renderAnnotationImage: async () =>
            "data:image/png;base64,iVBORw0KGgo=",
        },
      },
    },
  } as unknown as PdfReader;

  const bytes = await renderReaderImageCropBytes(reader, {
    pageIndex: 0,
    rect: [0, 0, 10, 10],
  });

  assert.deepEqual(
    [...new Uint8Array(bytes)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
});

test("rejects a reader renderer that does not return a PNG data URL", async () => {
  const reader = {
    _internalReader: {
      _lastView: {
        _pdfRenderer: {
          _renderAnnotationImage: async () => "not-an-image",
        },
      },
    },
  } as unknown as PdfReader;

  await assert.rejects(
    renderReaderImageCrop(reader, { pageIndex: 0, rect: [0, 0, 10, 10] }),
    /did not return a PNG/,
  );
});

test("rejects invalid page coordinates before entering Zotero", async () => {
  let called = false;
  const reader = {
    _internalReader: {
      _lastView: {
        _pdfRenderer: {
          _renderAnnotationImage: async () => {
            called = true;
            return PNG_DATA_URL;
          },
        },
      },
    },
  } as unknown as PdfReader;

  await assert.rejects(
    renderReaderImageCrop(reader, { pageIndex: 0, rect: [10, 10, 10, 20] }),
    /invalid PDF crop rectangle/,
  );
  assert.equal(called, false);
});
