import * as assert from "node:assert/strict";
import test from "node:test";
import { bytesToDataURL } from "../src/utils/dataURL";

test("encodes PNG bytes without reading the byte array iterator", () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  Object.defineProperty(bytes, Symbol.iterator, {
    get() {
      throw new Error("Permission denied to access property Symbol.iterator");
    },
  });

  assert.equal(
    bytesToDataURL(bytes, "image/png"),
    "data:image/png;base64,iVBORw0KGgo=",
  );
});

test("preserves base64 boundaries across encoding chunks", () => {
  const bytes = new Uint8Array(24 * 1024 + 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = index % 251;
  }

  assert.equal(
    bytesToDataURL(bytes, "application/octet-stream"),
    `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
  );
});
