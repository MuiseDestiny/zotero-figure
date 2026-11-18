import {
  removeGeneratedAnnotationForCandidate,
  removeGeneratedAnnotations,
} from "../../platform/zotero/annotations";
import {
  confirmFigureResultRemoval,
  getDocumentPdfAttachments,
} from "../../platform/zotero/figureResultRemoval";
import { getString } from "../../utils/locale";
import { OperationCancelledError } from "../../utils/cancellation";
import {
  isAttachmentBusy,
  tryAcquireAttachmentOperation,
} from "./attachmentOperations";
import {
  FigureResultStore,
  type StoredFigureResult,
} from "./figureResultStore";

export interface FigureResultsRemoved {
  attachmentIDs: number[];
  libraryID: number;
}

export class FigureResultRemovalService {
  private readonly listeners = new Set<
    (change: FigureResultsRemoved) => void
  >();
  private disposed = false;

  constructor(private readonly store: FigureResultStore) {}

  public subscribe(
    listener: (change: FigureResultsRemoved) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  public async isBusy(
    libraryID: number,
    documentItemID: number,
  ): Promise<boolean> {
    return (await getDocumentPdfAttachments(libraryID, documentItemID)).some(
      isAttachmentBusy,
    );
  }

  public async clearDocument(
    owner: Window,
    libraryID: number,
    documentItemID: number,
  ): Promise<void> {
    const attachments = await getDocumentPdfAttachments(
      libraryID,
      documentItemID,
    );
    await this.withIdleAttachments(attachments, async () => {
      const groups = await Promise.all(
        attachments.map(async (item) => ({
          item,
          results: await this.store.list(item),
        })),
      );
      const populated = groups.filter(({ results }) => results.length);
      this.assertActive();
      if (!populated.length) return;
      const decision = confirmFigureResultRemoval(
        owner,
        populated[0].item.topLevelItem.getDisplayTitle(),
        populated.length,
        populated.reduce((count, { results }) => count + results.length, 0),
        true,
      );
      if (!decision) return;
      const errors: unknown[] = [];
      try {
        for (const { item } of populated) {
          this.assertActive();
          try {
            await this.clearUnlocked(item, decision.removeAnnotations, false);
          } catch (error) {
            errors.push(error);
            Zotero.logError(toError(error));
          }
        }
      } finally {
        this.notify(populated.map(({ item }) => item));
      }
      if (errors.length)
        throw new Error(getString("gallery-delete-partial-error"));
    });
  }

  public async removeResult(
    owner: Window,
    attachment: Zotero.Item,
    resultID: string,
  ): Promise<void> {
    await this.withIdleAttachments([attachment], async () => {
      const result = (await this.store.list(attachment)).find(
        ({ id }) => id === resultID,
      );
      this.assertActive();
      if (!result) return;
      const decision = confirmFigureResultRemoval(
        owner,
        attachment.topLevelItem.getDisplayTitle(),
        1,
        1,
        false,
      );
      if (!decision) return;
      await this.removeUnlocked(attachment, result, decision.removeAnnotations);
    });
  }

  // The Reader's existing clear action remains an immediate local-only clear.
  public async clearLocal(attachment: Zotero.Item): Promise<void> {
    await this.withIdleAttachments([attachment], async () => {
      await this.clearUnlocked(attachment, false);
    });
  }

  private async clearUnlocked(
    item: Zotero.Item,
    removeAnnotations: boolean,
    notify = true,
  ): Promise<void> {
    this.assertActive();
    try {
      await this.store.clear(item);
      if (removeAnnotations) await removeGeneratedAnnotations(item);
    } finally {
      // Refresh even after partial filesystem/annotation failures.
      if (notify) this.notify([item]);
    }
  }

  private async removeUnlocked(
    item: Zotero.Item,
    result: StoredFigureResult,
    removeAnnotations: boolean,
  ): Promise<void> {
    this.assertActive();
    try {
      await this.store.remove(item, result.id);
      if (removeAnnotations)
        await removeGeneratedAnnotationForCandidate(item, result);
    } finally {
      this.notify([item]);
    }
  }

  private notify(items: Zotero.Item[]): void {
    if (!items.length) return;
    const change = {
      attachmentIDs: items.map(({ id }) => id),
      libraryID: items[0].libraryID,
    };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        Zotero.logError(toError(error));
      }
    }
  }

  private async withIdleAttachments(
    attachments: Zotero.Item[],
    action: () => Promise<void>,
  ): Promise<void> {
    this.assertActive();
    const releases: Array<() => void> = [];
    try {
      for (const item of attachments) {
        const reservation = tryAcquireAttachmentOperation(item);
        if (!reservation) throw new Error(getString("gallery-delete-busy"));
        releases.push(await reservation);
      }
      await action();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new OperationCancelledError();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
