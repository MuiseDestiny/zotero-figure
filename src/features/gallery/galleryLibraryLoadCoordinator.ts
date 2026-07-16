import type { FigureGallerySnapshot } from "../../domain/figureGallery";

export interface GalleryLibraryLoadPort<FilterOptions> {
  buildFilterOptions(snapshot: FigureGallerySnapshot): Promise<FilterOptions>;
  commit(snapshot: FigureGallerySnapshot, options: FilterOptions): void;
  isSelectedLibrary(libraryID: number): boolean;
  loadSnapshot(libraryID: number): Promise<FigureGallerySnapshot>;
  reportError(
    error: unknown,
    libraryID: number,
    loadedSnapshot?: FigureGallerySnapshot,
  ): void;
  setControlsDisabled(disabled: boolean): void;
  showLoading(): void;
}

/**
 * Serializes the visible state of overlapping gallery refreshes without
 * serializing their underlying I/O. Superseded requests may finish, but only
 * the newest request is allowed to mutate the view.
 */
export class GalleryLibraryLoadCoordinator<FilterOptions> {
  private requestID = 0;

  constructor(private readonly port: GalleryLibraryLoadPort<FilterOptions>) {}

  public async load(libraryID: number): Promise<void> {
    if (!Number.isInteger(libraryID)) return;
    const requestID = ++this.requestID;
    let loadedSnapshot: FigureGallerySnapshot | undefined;
    this.port.setControlsDisabled(true);
    this.port.showLoading();

    try {
      const snapshot = await this.port.loadSnapshot(libraryID);
      loadedSnapshot = snapshot;
      if (!this.canCommit(requestID, snapshot.libraryID)) return;
      const options = await this.port.buildFilterOptions(snapshot);
      if (!this.canCommit(requestID, snapshot.libraryID)) return;
      this.port.commit(snapshot, options);
    } catch (error) {
      if (requestID === this.requestID) {
        this.port.reportError(error, libraryID, loadedSnapshot);
      }
    } finally {
      if (requestID === this.requestID) {
        this.port.setControlsDisabled(false);
      }
    }
  }

  public cancel(): void {
    this.requestID++;
  }

  private canCommit(requestID: number, libraryID: number): boolean {
    return (
      requestID === this.requestID && this.port.isSelectedLibrary(libraryID)
    );
  }
}
