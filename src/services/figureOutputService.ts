import type { AnnotationCandidate } from "../domain/layout";
import {
  reconcileGeneratedAnnotations,
  type DuplicateMode,
  type ReconcileResult,
} from "../platform/zotero/annotations";
import { encodeNoteImageNavigation } from "../platform/zotero/noteNavigation";
import { getString } from "../utils/locale";
import {
  FigureResultStore,
  type StoredFigureResult,
} from "./results/figureResultStore";

export class FigureOutputService {
  constructor(private readonly resultStore: FigureResultStore) {}

  public async createNoteFromResults(
    attachment: Zotero.Item,
    results: readonly StoredFigureResult[],
  ): Promise<Zotero.Item | undefined> {
    if (results.length === 0) return undefined;
    let note: Zotero.Item | undefined;
    let noteSaved = false;
    try {
      note = new Zotero.Item("note");
      note.libraryID = attachment.libraryID;
      if (attachment.parentID) note.parentID = attachment.parentID;
      await note.saveTx({ skipSelect: true });
      const html: string[] = [
        '<div class="zotero-figure-note" data-citation-items="%5B%5D" data-schema-version="9">',
        `<h2>${escapeHTML(getString("note-title"))}</h2>`,
      ];
      const attachmentURI = String(Zotero.URI.getItemURI(attachment));
      for (const result of results) {
        const bytes = await IOUtils.read(result.imagePath);
        const image = await Zotero.Attachments.importEmbeddedImage({
          blob: new Blob([bytes], { type: "image/png" }),
          parentItemID: note.id,
          saveOptions: { skipSelect: true },
        });
        html.push(
          `<p><strong>${escapeHTML(result.tag)}</strong> · ${escapeHTML(
            getString("sidebar-page", { args: { page: result.pageLabel } }),
          )}</p>`,
          `<img data-attachment-key="${image.key}" data-annotation="${encodeNoteImageNavigation(
            attachmentURI,
            result,
          )}" alt="${escapeHTML(result.comment)}" />`,
          result.comment ? `<p>${escapeHTML(result.comment)}</p>` : "",
        );
      }
      html.push("</div>");
      note.setNote(html.join(""));
      await note.saveTx({ skipSelect: true });
      noteSaved = true;
      return note;
    } catch (error) {
      if (note?.id && !noteSaved) {
        try {
          await note.eraseTx();
        } catch (cleanupError) {
          Zotero.logError(toError(cleanupError));
        }
      }
      throw error;
    }
  }

  public async syncStoredResultsToAnnotations(
    attachment: Zotero.Item,
    mode: DuplicateMode,
  ): Promise<ReconcileResult> {
    const results = await this.resultStore.list(attachment);
    const candidatesByPage = groupCandidatesByPage(results);
    const summary: ReconcileResult = { created: 0, removed: 0, skipped: 0 };
    for (const [pageIndex, candidates] of candidatesByPage) {
      const reconciled = await reconcileGeneratedAnnotations(
        attachment,
        pageIndex,
        candidates,
        mode,
      );
      summary.created += reconciled.created;
      summary.removed += reconciled.removed;
      summary.skipped += reconciled.skipped;
    }
    return summary;
  }
}

function groupCandidatesByPage(
  results: readonly StoredFigureResult[],
): Array<[number, AnnotationCandidate[]]> {
  const candidatesByPage = new Map<number, AnnotationCandidate[]>();
  for (const result of results) {
    const candidates = candidatesByPage.get(result.pageIndex) ?? [];
    candidates.push({
      comment: result.comment,
      pageIndex: result.pageIndex,
      rect: result.rect,
      tag: result.tag,
    });
    candidatesByPage.set(result.pageIndex, candidates);
  }
  return [...candidatesByPage].sort(([first], [second]) => first - second);
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
