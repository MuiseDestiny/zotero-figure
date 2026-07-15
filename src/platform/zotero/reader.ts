export type PdfReader = _ZoteroTypes.ReaderInstance<"pdf">;

const READER_READY_TIMEOUT_MS = 30_000;

/** Open a Reader only for workflows that explicitly need Reader APIs. */
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
    if (reader && focus) Zotero_Tabs.select(tab.id);
  }

  reader ??= (await Zotero.Reader.open(itemID, undefined, {
    openInBackground: !focus,
  })) as PdfReader | undefined;

  if (!reader) throw new Error(`Unable to open PDF reader for item ${itemID}`);
  await waitForPdfDocument(reader);
  return reader;
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
