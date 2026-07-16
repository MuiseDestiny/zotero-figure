import type { FigureGalleryImage } from "../../domain/figureGallery";
import { BoundedAsyncTaskQueue } from "../../services/concurrency/boundedAsyncTaskQueue";
import {
  monitorImageLoad,
  type ImageLoadMonitor,
} from "../reader/imageLoadMonitor";

const DEFAULT_IMAGE_CONCURRENCY = 4;

export interface GalleryImageLoadRequest {
  entryID: string;
  generation: number;
  image: HTMLImageElement;
  onFailed(): void;
  onLoaded(): void;
}

export interface GalleryImageLoadRuntime {
  createObjectURL(payload: FigureGalleryImage): string;
  monitor(image: HTMLImageElement): ImageLoadMonitor;
  revokeObjectURL(url: string): void;
}

export interface GalleryImageLoadOptions {
  concurrency?: number;
  runtime?: GalleryImageLoadRuntime;
}

interface ActiveGalleryImageLoadRequest extends GalleryImageLoadRequest {
  token: object;
}

/** Owns bounded gallery image work and every Blob URL created for it. */
export class GalleryImageLoadCoordinator {
  private readonly runtime: GalleryImageLoadRuntime;
  private readonly blobURLs = new Map<HTMLImageElement, string>();
  private readonly imageTokens = new WeakMap<HTMLImageElement, object>();
  private readonly loadCancellers = new Map<
    HTMLImageElement,
    { cancel(): void; token: object }
  >();
  private readonly loadQueue: BoundedAsyncTaskQueue;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly readImage: (
      entryID: string,
    ) => Promise<FigureGalleryImage>,
    options: GalleryImageLoadOptions = {},
  ) {
    this.loadQueue = new BoundedAsyncTaskQueue(
      options.concurrency ?? DEFAULT_IMAGE_CONCURRENCY,
    );
    this.runtime = options.runtime ?? browserImageLoadRuntime;
  }

  public beginGeneration(): number {
    if (this.disposed) return this.generation;
    this.generation++;
    this.loadQueue.cancelPending();
    this.releaseImages();
    return this.generation;
  }

  public enqueue(request: GalleryImageLoadRequest): void {
    if (this.disposed || request.generation !== this.generation) return;
    const activeRequest: ActiveGalleryImageLoadRequest = {
      ...request,
      token: {},
    };
    this.imageTokens.set(request.image, activeRequest.token);
    if (!this.isCurrent(activeRequest)) return;
    const task = this.loadQueue.enqueue(() => this.load(activeRequest));
    void task.promise.catch(() => {
      // load() is the presentation error boundary. Keep the queue safe if a
      // future implementation adds work outside that boundary.
    });
  }

  public unregister(image: HTMLImageElement): void {
    this.imageTokens.delete(image);
    this.cancelImageLoad(image);
    this.releaseImageURL(image);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.loadQueue.cancelPending();
    this.releaseImages();
  }

  private async load(request: ActiveGalleryImageLoadRequest): Promise<void> {
    if (!this.isCurrent(request)) return;
    let cancelLoad: (() => void) | undefined;
    try {
      const payload = await this.readImage(request.entryID);
      if (!this.isCurrent(request)) return;
      this.releaseImageURL(request.image);
      const url = this.runtime.createObjectURL(payload);
      this.blobURLs.set(request.image, url);
      const monitor = this.runtime.monitor(request.image);
      cancelLoad = () => monitor.cancel();
      this.loadCancellers.set(request.image, {
        cancel: cancelLoad,
        token: request.token,
      });
      request.image.src = url;
      const outcome = await monitor.promise;
      if (outcome !== "loaded" || !this.isCurrent(request)) {
        this.releaseImageURL(request.image);
        if (outcome === "failed" && this.isCurrent(request)) {
          this.notifyFailed(request);
        }
        return;
      }
      request.onLoaded();
    } catch {
      if (cancelLoad) {
        try {
          cancelLoad();
        } catch {
          // Continue through URL and presentation cleanup.
        }
      }
      this.releaseImageURL(request.image);
      if (this.isCurrent(request)) this.notifyFailed(request);
    } finally {
      const active = this.loadCancellers.get(request.image);
      if (active?.token === request.token) {
        this.loadCancellers.delete(request.image);
      }
    }
  }

  private isCurrent(request: ActiveGalleryImageLoadRequest): boolean {
    return (
      !this.disposed &&
      request.generation === this.generation &&
      this.imageTokens.get(request.image) === request.token &&
      request.image.isConnected
    );
  }

  private notifyFailed(request: GalleryImageLoadRequest): void {
    try {
      request.onFailed();
    } catch {
      // A presentation callback must not stall the bounded queue.
    }
  }

  private releaseImages(): void {
    for (const { cancel } of [...this.loadCancellers.values()]) {
      try {
        cancel();
      } catch {
        // Continue releasing the remaining generation resources.
      }
    }
    this.loadCancellers.clear();
    const urls = [...this.blobURLs.values()];
    this.blobURLs.clear();
    for (const url of urls) this.revokeObjectURL(url);
  }

  private cancelImageLoad(image: HTMLImageElement): void {
    const active = this.loadCancellers.get(image);
    if (!active) return;
    this.loadCancellers.delete(image);
    try {
      active.cancel();
    } catch {
      // Continue through URL cleanup even if a monitor cannot be cancelled.
    }
  }

  private releaseImageURL(image: HTMLImageElement): void {
    const url = this.blobURLs.get(image);
    if (!url) return;
    this.blobURLs.delete(image);
    this.revokeObjectURL(url);
  }

  private revokeObjectURL(url: string): void {
    try {
      this.runtime.revokeObjectURL(url);
    } catch {
      // Revocation is best-effort and must not block queue cleanup.
    }
  }
}

const browserImageLoadRuntime: GalleryImageLoadRuntime = {
  createObjectURL: (payload) =>
    URL.createObjectURL(
      new Blob([decodeBase64(payload.base64)], { type: payload.mimeType }),
    ),
  monitor: monitorImageLoad,
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
