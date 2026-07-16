import type { FigureGalleryLibrary } from "../../domain/figureGallery";
import type { Rect } from "../../domain/layout";

export interface FigureGalleryPlatform {
  getAttachment(libraryID: number, key: string): Promise<Zotero.Item | false>;
  getCollectionName(collectionID: number): string | undefined;
  getDefaultLibraryID(): number;
  listLibraries(): FigureGalleryLibrary[];
  logError(error: Error): void;
  openPdf(attachmentID: number, pageIndex: number, rect: Rect): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
}

export function createZoteroFigureGalleryPlatform(): FigureGalleryPlatform {
  return {
    getAttachment: (libraryID, key) =>
      Zotero.Items.getByLibraryAndKeyAsync(libraryID, key),
    getCollectionName: (collectionID) =>
      Zotero.Collections.get(collectionID)?.name,
    getDefaultLibraryID: () => {
      const selected = Zotero.getActiveZoteroPane()?.getSelectedLibraryID();
      return Number.isInteger(selected)
        ? (selected as number)
        : Zotero.Libraries.userLibraryID;
    },
    listLibraries: () =>
      Zotero.Libraries.getAll()
        .filter(({ libraryType }) => libraryType !== "feed")
        .map(({ libraryID, name }) => ({ id: libraryID, name })),
    logError: (error) => Zotero.logError(error),
    openPdf: async (attachmentID, pageIndex, rect) => {
      await Zotero.Reader.open(
        attachmentID,
        { position: { pageIndex, rects: [rect] } },
        { openInBackground: false },
      );
    },
    readFile: (path) => IOUtils.read(path),
  };
}
