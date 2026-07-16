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
  private pendingLoad?: PendingGalleryLoad;
  private requestID = 0;

  constructor(private readonly port: GalleryLibraryLoadPort<FilterOptions>) {}

  public async load(libraryID: number): Promise<void> {
    if (!Number.isInteger(libraryID)) return;
    const requestID = ++this.requestID;
    const pendingLoad: PendingGalleryLoad = { requestID, updates: [] };
    this.pendingLoad = pendingLoad;
    let loadedSnapshot: FigureGallerySnapshot | undefined;
    this.port.setControlsDisabled(true);
    this.port.showLoading();

    try {
      const snapshot = await this.port.loadSnapshot(libraryID);
      loadedSnapshot = snapshot;
      pendingLoad.snapshot = snapshot;
      for (const update of pendingLoad.updates) update(snapshot);
      pendingLoad.updates.length = 0;
      if (!this.canCommit(requestID, snapshot.libraryID)) return;
      const options = await this.port.buildFilterOptions(snapshot);
      if (!this.canCommit(requestID, snapshot.libraryID)) return;
      this.port.commit(snapshot, options);
    } catch (error) {
      if (requestID === this.requestID) {
        this.port.reportError(error, libraryID, loadedSnapshot);
      }
    } finally {
      if (this.pendingLoad === pendingLoad) this.pendingLoad = undefined;
      if (requestID === this.requestID) {
        this.port.setControlsDisabled(false);
      }
    }
  }

  public cancel(): void {
    this.requestID++;
    this.pendingLoad = undefined;
  }

  public updatePendingSnapshot(
    update: (snapshot: FigureGallerySnapshot) => void,
  ): void {
    const pendingLoad = this.pendingLoad;
    if (!pendingLoad || pendingLoad.requestID !== this.requestID) return;
    if (pendingLoad.snapshot) update(pendingLoad.snapshot);
    else pendingLoad.updates.push(update);
  }

  private canCommit(requestID: number, libraryID: number): boolean {
    return (
      requestID === this.requestID && this.port.isSelectedLibrary(libraryID)
    );
  }
}

interface PendingGalleryLoad {
  requestID: number;
  snapshot?: FigureGallerySnapshot;
  updates: Array<(snapshot: FigureGallerySnapshot) => void>;
}
