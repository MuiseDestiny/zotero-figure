import * as assert from "node:assert/strict";
import test from "node:test";
import { encodeNoteImageNavigation } from "../src/platform/zotero/noteNavigation";

test("encodes Zotero note image navigation without requiring an annotation", () => {
  const encoded = encodeNoteImageNavigation(
    "http://zotero.org/users/local/abc/items/ATTACHMENT",
    {
      pageIndex: 3,
      pageLabel: "4",
      rect: [12, 24, 180, 260],
    },
  );

  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), {
    attachmentURI: "http://zotero.org/users/local/abc/items/ATTACHMENT",
    color: "#d2d8e2",
    pageLabel: "4",
    position: {
      pageIndex: 3,
      rects: [[12, 24, 180, 260]],
    },
  });
});
