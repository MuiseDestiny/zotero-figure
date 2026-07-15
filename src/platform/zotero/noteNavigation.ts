import type { Rect } from "../../domain/layout";

interface NoteImageLocation {
  pageIndex: number;
  pageLabel: string;
  rect: Rect;
}

/**
 * Zotero's note editor opens images carrying this metadata in the source PDF.
 * An annotation key is intentionally omitted because local figure results do
 * not require a persisted Zotero annotation.
 */
export function encodeNoteImageNavigation(
  attachmentURI: string,
  location: NoteImageLocation,
): string {
  if (!attachmentURI) throw new Error("PDF attachment URI is unavailable");
  return encodeURIComponent(
    JSON.stringify({
      attachmentURI,
      color: "#d2d8e2",
      pageLabel: location.pageLabel,
      position: {
        pageIndex: location.pageIndex,
        rects: [[...location.rect]],
      },
    }),
  );
}
