import { isNearVerticalViewport } from "../../domain/figureSidebar";
import {
  createDocumentBlobURL,
  type RevocableBlobURL,
} from "../../platform/zotero/browserGlobals";
import {
  BoundedAsyncTaskQueue,
  type AsyncTaskHandle,
} from "../../services/concurrency/boundedAsyncTaskQueue";
import { getString } from "../../utils/locale";
import { monitorImageLoad, type ImageLoadMonitor } from "./imageLoadMonitor";

export const SIDEBAR_IMAGE_LOAD_CONCURRENCY = 3;
export const SIDEBAR_IMAGE_PRELOAD_VIEWPORTS = 1;

export interface SidebarImageSource {
  id: string;
  imagePath: string;
}

type PlaceholderState = "failed" | "pending";

interface SidebarImageEntry {
  container: HTMLDivElement;
  document: Document;
  generation: number;
  image: HTMLImageElement;
  loadMonitor?: ImageLoadMonitor;
  result: SidebarImageSource;
  releaseURL?: () => void;
  state: ImageLoadState;
  task?: AsyncTaskHandle;
}

type ImageLoadState = "failed" | "loaded" | "loading" | "pending" | "queued";

type TimerHost = Pick<Window, "clearTimeout" | "setTimeout">;

export interface SidebarImageLoadCoordinatorOptions {
  concurrency?: number;
  createBlobURL?(document: Document, bytes: Uint8Array): RevocableBlobURL;
  createPlaceholder?(document: Document, state: PlaceholderState): Node;
  logError?(error: Error): void;
  monitorImage?(image: HTMLImageElement): ImageLoadMonitor;
  ownerWindow: TimerHost;
  preloadViewports?: number;
  readBytes?(path: string): Promise<Uint8Array>;
}

/** Owns lazy preview loading for one Reader sidebar across render generations. */
export class SidebarImageLoadCoordinator {
  private active = false;
  private readonly blobURLReleasers = new Set<() => void>();
  private readonly createBlobURL: NonNullable<
    SidebarImageLoadCoordinatorOptions["createBlobURL"]
  >;
  private readonly createPlaceholder: NonNullable<
    SidebarImageLoadCoordinatorOptions["createPlaceholder"]
  >;
  private disposed = false;
  private readonly entries = new Set<SidebarImageEntry>();
  private generation = 0;
  private readonly initialBatchSize: number;
  private readonly loadQueue: BoundedAsyncTaskQueue;
  private readonly logError: NonNullable<
    SidebarImageLoadCoordinatorOptions["logError"]
  >;
  private readonly monitorImage: NonNullable<
    SidebarImageLoadCoordinatorOptions["monitorImage"]
  >;
  private readonly ownerWindow: TimerHost;
  private readonly preloadViewports: number;
  private readonly readBytes: NonNullable<
    SidebarImageLoadCoordinatorOptions["readBytes"]
  >;
  private viewport?: HTMLElement;
  private visibilityTimerID?: number;

  constructor(options: SidebarImageLoadCoordinatorOptions) {
    this.createBlobURL =
      options.createBlobURL ??
      ((document, bytes) =>
        createDocumentBlobURL(document, [bytes], { type: "image/png" }));
    this.createPlaceholder =
      options.createPlaceholder ?? createSidebarImagePlaceholder;
    this.initialBatchSize =
      options.concurrency ?? SIDEBAR_IMAGE_LOAD_CONCURRENCY;
    this.loadQueue = new BoundedAsyncTaskQueue(this.initialBatchSize);
    this.logError =
      options.logError ?? ((error) => Zotero.logError(toError(error)));
    this.monitorImage = options.monitorImage ?? monitorImageLoad;
    this.ownerWindow = options.ownerWindow;
    this.preloadViewports =
      options.preloadViewports ?? SIDEBAR_IMAGE_PRELOAD_VIEWPORTS;
    this.readBytes = options.readBytes ?? ((path) => IOUtils.read(path));
  }

  public register(
    container: HTMLDivElement,
    result: SidebarImageSource,
    alt: string,
  ): void {
    if (this.disposed) return;
    const document = container.ownerDocument;
    const image = document.createElement("img");
    image.alt = alt;
    image.decoding = "async";
    this.entries.add({
      container,
      document,
      generation: this.generation,
      image,
      result,
      state: "pending",
    });
    container.replaceChildren(this.createPlaceholder(document, "pending"));
  }

  public updateResult(result: SidebarImageSource, alt: string): void {
    for (const entry of this.entries) {
      if (entry.result.id !== result.id) continue;
      entry.result = result;
      entry.image.alt = alt;
    }
  }

  public unregister(resultID: string): void {
    for (const entry of [...this.entries]) {
      if (entry.result.id !== resultID) continue;
      entry.task?.cancel();
      entry.loadMonitor?.cancel();
      this.entries.delete(entry);
      if (entry.releaseURL) this.releaseBlobURL(entry.releaseURL);
    }
  }

  public setViewport(viewport: HTMLElement | undefined): void {
    if (this.viewport === viewport) return;
    this.viewport = viewport;
    this.refresh();
  }

  public setActive(active: boolean): void {
    this.active = active;
    if (active) this.refresh();
    else this.cancelQueuedLoads();
  }

  public refresh(): void {
    if (this.disposed || !this.active || this.visibilityTimerID !== undefined) {
      return;
    }
    this.visibilityTimerID = this.ownerWindow.setTimeout(() => {
      this.visibilityTimerID = undefined;
      this.scanVisibility();
    }, 0);
  }

  /** Invalidates one render generation while keeping the coordinator reusable. */
  public reset(): void {
    if (this.disposed) return;
    this.clearEntries();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.viewport = undefined;
    this.clearEntries();
  }

  private scanVisibility(): void {
    if (this.disposed || !this.active) return;
    const viewport = this.viewport;
    if (!viewport?.isConnected) return;
    const candidates = [...this.entries].filter(
      (entry) => entry.state === "pending" && this.isCurrent(entry),
    );
    if (candidates.length === 0) return;

    const bounds = viewport.getBoundingClientRect();
    const viewportHeight = Math.max(0, bounds.bottom - bounds.top);
    if (viewportHeight === 0) {
      for (const entry of candidates.slice(0, this.initialBatchSize)) {
        this.queueLoad(entry);
      }
      return;
    }

    const preloadDistance = viewportHeight * this.preloadViewports;
    for (const entry of candidates) {
      if (
        isNearVerticalViewport(
          entry.container.getBoundingClientRect(),
          bounds,
          preloadDistance,
        )
      ) {
        this.queueLoad(entry);
      }
    }
  }

  private queueLoad(entry: SidebarImageEntry): void {
    if (entry.state !== "pending" || !this.isCurrent(entry)) return;
    entry.state = "queued";
    const task = this.loadQueue.enqueue(async () => {
      if (!this.isCurrent(entry)) return;
      entry.state = "loading";
      await this.load(entry);
    });
    entry.task = task;
    void task.promise.then(
      () => this.finishLoad(entry, task),
      (error) => {
        this.logError(toError(error));
        this.finishLoad(entry, task);
      },
    );
  }

  private async load(entry: SidebarImageEntry): Promise<void> {
    let releaseURL: (() => void) | undefined;
    try {
      const bytes = await this.readBytes(entry.result.imagePath);
      if (!this.isCurrent(entry)) return;
      const blobURL = this.createBlobURL(entry.document, bytes);
      releaseURL = () => blobURL.release();
      entry.releaseURL = releaseURL;
      this.blobURLReleasers.add(releaseURL);
      if (!this.isCurrent(entry)) {
        this.releaseBlobURL(releaseURL);
        return;
      }
      const loadMonitor = this.monitorImage(entry.image);
      entry.loadMonitor = loadMonitor;
      entry.image.src = blobURL.url;
      entry.container.replaceChildren(entry.image);
      const outcome = await loadMonitor.promise;
      if (entry.loadMonitor === loadMonitor) entry.loadMonitor = undefined;
      if (outcome === "cancelled" || !this.isCurrent(entry)) {
        this.releaseBlobURL(releaseURL);
        entry.releaseURL = undefined;
        return;
      }
      if (outcome === "loaded") {
        entry.state = "loaded";
        entry.container.style.aspectRatio = "";
        entry.container.classList.add("is-loaded");
        return;
      }
      entry.state = "failed";
      this.releaseBlobURL(releaseURL);
      entry.releaseURL = undefined;
      entry.container.replaceChildren(
        this.createPlaceholder(entry.document, "failed"),
      );
    } catch (error) {
      if (releaseURL) this.releaseBlobURL(releaseURL);
      entry.releaseURL = undefined;
      if (!this.isCurrent(entry)) return;
      this.logError(toError(error));
      entry.state = "failed";
      entry.container.replaceChildren(
        this.createPlaceholder(entry.document, "failed"),
      );
    }
  }

  private finishLoad(entry: SidebarImageEntry, task: AsyncTaskHandle): void {
    if (entry.task !== task) return;
    entry.task = undefined;
    if (entry.state === "queued") entry.state = "pending";
    this.refresh();
  }

  private cancelQueuedLoads(): void {
    for (const entry of this.entries) {
      if (entry.state !== "queued" || !entry.task?.cancel()) continue;
      entry.task = undefined;
      entry.state = "pending";
    }
  }

  private clearEntries(): void {
    this.generation++;
    if (this.visibilityTimerID !== undefined) {
      this.ownerWindow.clearTimeout(this.visibilityTimerID);
      this.visibilityTimerID = undefined;
    }
    this.loadQueue.cancelPending();
    for (const entry of this.entries) entry.loadMonitor?.cancel();
    this.entries.clear();
    for (const release of [...this.blobURLReleasers]) {
      this.releaseBlobURL(release);
    }
  }

  private isCurrent(entry: SidebarImageEntry): boolean {
    return (
      !this.disposed &&
      entry.generation === this.generation &&
      this.entries.has(entry) &&
      entry.container.isConnected
    );
  }

  private releaseBlobURL(release: () => void): void {
    if (!this.blobURLReleasers.delete(release)) return;
    try {
      release();
    } catch (error) {
      this.logError(toError(error));
    }
  }
}

function createSidebarImagePlaceholder(
  document: Document,
  state: PlaceholderState,
): HTMLSpanElement {
  const placeholder = document.createElement("span");
  placeholder.className = "zoterofigure-card-image-placeholder";
  placeholder.textContent = getString(
    state === "failed"
      ? "sidebar-image-unavailable"
      : "sidebar-image-preparing",
  );
  return placeholder;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
