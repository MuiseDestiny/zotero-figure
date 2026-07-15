import {
  extractFigureGalleryYear,
  type FigureGalleryBootstrap,
  type FigureGalleryEntry,
  type FigureGalleryImage,
  type FigureGallerySnapshot,
} from "../../domain/figureGallery";
import type { Rect } from "../../domain/layout";
import {
  createZoteroFigureGalleryPlatform,
  type FigureGalleryPlatform,
} from "../../platform/zotero/figureGallery";
import type { StoredFigureResult } from "./figureResultStore";

const INDEX_CONCURRENCY = 4;

interface FigureGalleryResultStore {
  list(item: Zotero.Item): Promise<StoredFigureResult[]>;
  listIndexedAttachmentKeys(libraryID: number): Promise<string[]>;
}

interface IndexedFigureSource {
  attachmentID: number;
  imagePath: string;
  libraryID: number;
  pageIndex: number;
  rect: Rect;
}

export class FigureGalleryIndex {
  private readonly sources = new Map<string, IndexedFigureSource>();

  constructor(
    private readonly resultStore: FigureGalleryResultStore,
    private readonly platform: FigureGalleryPlatform = createZoteroFigureGalleryPlatform(),
  ) {}

  public getBootstrap(): FigureGalleryBootstrap {
    const libraries = this.platform
      .listLibraries()
      .sort((first, second) => first.name.localeCompare(second.name));
    const configuredDefault = this.platform.getDefaultLibraryID();
    return {
      defaultLibraryID:
        libraries.find(({ id }) => id === configuredDefault)?.id ??
        libraries[0]?.id ??
        0,
      libraries,
    };
  }

  public async loadLibrary(libraryID: number): Promise<FigureGallerySnapshot> {
    if (!this.getBootstrap().libraries.some(({ id }) => id === libraryID)) {
      throw new Error(`Figure gallery library ${libraryID} is unavailable`);
    }

    const keys = await this.resultStore.listIndexedAttachmentKeys(libraryID);
    const groups = await mapConcurrent(
      keys,
      INDEX_CONCURRENCY,
      async (key) => await this.loadAttachment(libraryID, key),
    );
    const entries = groups
      .flat()
      .sort(compareFigureGalleryEntries)
      .map(({ entry, source }) => {
        this.sources.set(entry.id, source);
        return entry;
      });
    return {
      entries,
      generatedAt: new Date().toISOString(),
      libraryID,
    };
  }

  public async readImage(entryID: string): Promise<FigureGalleryImage> {
    const source = this.getSource(entryID);
    const bytes = await this.platform.readFile(source.imagePath);
    return { base64: bytesToBase64(bytes), mimeType: "image/png" };
  }

  public async openSource(entryID: string): Promise<void> {
    const source = this.getSource(entryID);
    await this.platform.openPdf(
      source.attachmentID,
      source.pageIndex,
      source.rect,
    );
  }

  private getSource(entryID: string): IndexedFigureSource {
    const source = this.sources.get(entryID);
    if (!source) throw new Error("Figure gallery result is no longer indexed");
    return source;
  }

  private async loadAttachment(
    libraryID: number,
    attachmentKey: string,
  ): Promise<
    Array<{ entry: FigureGalleryEntry; source: IndexedFigureSource }>
  > {
    try {
      const attachment = await this.platform.getAttachment(
        libraryID,
        attachmentKey,
      );
      if (!attachment || !attachment.isPDFAttachment()) return [];
      const documentItem = attachment.topLevelItem;
      const collectionIDs = [
        ...new Set(documentItem.getCollections().filter(Number.isInteger)),
      ];
      const collectionPairs = collectionIDs.flatMap((id) => {
        const name = this.platform.getCollectionName(id);
        return name ? [{ id, name }] : [];
      });
      const documentTitle =
        documentItem.getDisplayTitle().trim() ||
        attachment.getDisplayTitle().trim();
      const year = extractFigureGalleryYear(
        documentItem.getField("date", true),
      );
      const results = await this.resultStore.list(attachment);
      return results.map((result) => {
        const id = `${libraryID}:${attachment.key}:${result.id}`;
        return {
          entry: {
            attachmentID: attachment.id,
            collectionIDs: collectionPairs.map((pair) => pair.id),
            collectionNames: collectionPairs.map((pair) => pair.name),
            comment: result.comment,
            documentItemID: documentItem.id,
            documentTitle,
            id,
            kind: result.kind,
            libraryID,
            pageIndex: result.pageIndex,
            pageLabel: result.pageLabel || String(result.pageIndex + 1),
            rect: [...result.rect] as Rect,
            tag: result.tag,
            year,
          },
          source: {
            attachmentID: attachment.id,
            imagePath: result.imagePath,
            libraryID,
            pageIndex: result.pageIndex,
            rect: [...result.rect] as Rect,
          },
        };
      });
    } catch (error) {
      this.platform.logError(toError(error));
      return [];
    }
  }
}

function compareFigureGalleryEntries(
  first: { entry: FigureGalleryEntry },
  second: { entry: FigureGalleryEntry },
): number {
  return (
    first.entry.documentTitle.localeCompare(second.entry.documentTitle) ||
    first.entry.pageIndex - second.entry.pageIndex ||
    first.entry.kind.localeCompare(second.entry.kind) ||
    first.entry.id.localeCompare(second.entry.id)
  );
}

async function mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  task: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    async () => {
      while (nextIndex < inputs.length) {
        const index = nextIndex++;
        results[index] = await task(inputs[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)),
    );
  }
  return btoa(chunks.join(""));
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
