import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolvePdfAttachments } from "../src/features/library/figureBatchController";

const controllerSource = readFileSync(
  "src/features/library/figureBatchController.ts",
  "utf8",
);

test("keeps the PDF Figure menu enabled while a batch is running", () => {
  assert.doesNotMatch(controllerSource, /isDisabled/);
  assert.match(controllerSource, /batch-progress-already-running/);
});

test("resolves selected literature to unique PDFs in selection order", async () => {
  const firstPdf = makePdf(101);
  const secondPdf = makePdf(202);
  const selected = [
    makeRegularItem(1, firstPdf),
    firstPdf,
    makeRegularItem(2, false),
    makeRegularItem(3, secondPdf),
  ];

  assert.deepEqual(await resolvePdfAttachments(selected), [
    firstPdf,
    secondPdf,
  ]);
});

function makePdf(id: number): Zotero.Item {
  return {
    id,
    isPDFAttachment: () => true,
    isRegularItem: () => false,
  } as unknown as Zotero.Item;
}

function makeRegularItem(
  id: number,
  attachment: Zotero.Item | false,
): Zotero.Item {
  return {
    getBestAttachment: async () => attachment,
    id,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;
}
