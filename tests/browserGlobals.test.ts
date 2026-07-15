import * as assert from "node:assert/strict";
import test from "node:test";
import {
  createBlobURLInRealm,
  createRealmSafeBlobConstructor,
} from "../src/platform/zotero/browserGlobals";

test("clones Blob parts before the browser realm reads their iterator", () => {
  const sourceParts: BlobPart[] = [Uint8Array.from([1, 2, 3])];
  Object.defineProperty(sourceParts, Symbol.iterator, {
    get() {
      throw new Error("Permission denied to access property Symbol.iterator");
    },
  });
  let receivedParts: BlobPart[] | undefined;
  let receivedOptions: BlobPropertyBag | undefined;
  class BrowserBlob {
    public readonly size = 3;
    public readonly type = "image/png";

    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      receivedParts = [...parts];
      receivedOptions = options;
    }
  }
  const target = {};
  const BlobConstructor = createRealmSafeBlobConstructor(
    BrowserBlob as unknown as typeof Blob,
    target,
    (value, receivedTarget) => {
      assert.equal(receivedTarget, target);
      if (value === sourceParts) return [sourceParts[0]] as typeof value;
      return { ...(value as BlobPropertyBag) } as typeof value;
    },
  );

  const blob = new BlobConstructor(sourceParts, { type: "image/png" });

  assert.equal(blob.size, 3);
  assert.deepEqual(receivedParts, [sourceParts[0]]);
  assert.deepEqual(receivedOptions, { type: "image/png" });
  assert.equal(blob instanceof BrowserBlob, true);
});

test("creates and revokes blob URLs in the consuming document realm", () => {
  const sourceParts: BlobPart[] = [Uint8Array.from([137, 80, 78, 71])];
  let createdBlob: BrowserBlob | undefined;
  let revokeCount = 0;
  let revokedURL: string | undefined;
  let cloneCount = 0;

  class BrowserBlob {
    constructor(
      public readonly parts: BlobPart[],
      public readonly options?: BlobPropertyBag,
    ) {}
  }

  const realm = {
    Blob: BrowserBlob as unknown as typeof Blob,
    URL: {
      createObjectURL(blob: Blob) {
        createdBlob = blob as unknown as BrowserBlob;
        return "blob:null/reader-realm-preview";
      },
      revokeObjectURL(url: string) {
        revokeCount++;
        revokedURL = url;
      },
    },
  };

  const objectURL = createBlobURLInRealm(
    realm,
    sourceParts,
    { type: "image/png" },
    (value, target) => {
      assert.equal(target, realm);
      cloneCount++;
      if (value === sourceParts) return [...sourceParts] as typeof value;
      return { ...(value as BlobPropertyBag) } as typeof value;
    },
  );

  assert.equal(objectURL.url, "blob:null/reader-realm-preview");
  assert.deepEqual(createdBlob?.parts, sourceParts);
  assert.deepEqual(createdBlob?.options, { type: "image/png" });
  assert.equal(cloneCount, 2);
  objectURL.release();
  objectURL.release();
  assert.equal(revokeCount, 1);
  assert.equal(revokedURL, objectURL.url);
});
