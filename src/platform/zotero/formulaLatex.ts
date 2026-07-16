export interface FormulaLatexLibrary {
  id: number;
}

export interface FormulaLatexPlatform {
  getAttachment(libraryID: number, key: string): Promise<Zotero.Item | false>;
  listLibraries(): FormulaLatexLibrary[];
  logError(error: Error): void;
}

export function createZoteroFormulaLatexPlatform(): FormulaLatexPlatform {
  return {
    getAttachment: (libraryID, key) =>
      Zotero.Items.getByLibraryAndKeyAsync(libraryID, key),
    listLibraries: () =>
      Zotero.Libraries.getAll()
        .filter(({ libraryType }) => libraryType !== "feed")
        .map(({ libraryID }) => ({ id: libraryID })),
    logError: (error) => Zotero.logError(error),
  };
}
