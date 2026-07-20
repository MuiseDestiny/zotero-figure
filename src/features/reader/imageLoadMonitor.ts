export type ImageLoadOutcome = "cancelled" | "failed" | "loaded";

export interface ImageLoadMonitor {
  cancel(): void;
  readonly promise: Promise<ImageLoadOutcome>;
}

/**
 * Observe an image before assigning its src. A load event already means the
 * resource is ready to display. Do not await decode(): Firefox can leave that
 * promise pending for Blob URLs in Reader documents and stall the whole queue.
 */
export function monitorImageLoad(image: HTMLImageElement): ImageLoadMonitor {
  let resolveOutcome!: (outcome: ImageLoadOutcome) => void;
  const promise = new Promise<ImageLoadOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  let settled = false;

  const settle = (outcome: ImageLoadOutcome): void => {
    if (settled) return;
    settled = true;
    image.removeEventListener("load", handleLoad);
    image.removeEventListener("error", handleError);
    resolveOutcome(outcome);
  };
  const handleLoad = (): void => settle("loaded");
  const handleError = (): void => settle("failed");

  image.addEventListener("load", handleLoad);
  image.addEventListener("error", handleError);
  return {
    cancel: () => settle("cancelled"),
    promise,
  };
}
