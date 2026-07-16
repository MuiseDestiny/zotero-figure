export type ImageLoadOutcome = "cancelled" | "failed" | "loaded";

export interface ImageLoadMonitor {
  cancel(): void;
  readonly promise: Promise<ImageLoadOutcome>;
}

/**
 * Observe an image before assigning its src. The load outcome is delayed until
 * Firefox has also finished decoding, so queue capacity reflects real image
 * work rather than only the preceding file read.
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
  const handleLoad = (): void => {
    let decoded: Promise<void>;
    try {
      decoded = image.decode();
    } catch {
      settle("loaded");
      return;
    }
    // A load event already proves the resource is usable. Some Firefox builds
    // reject decode() after displaying the image, so decode failure is not an
    // image failure here.
    void decoded.then(
      () => settle("loaded"),
      () => settle("loaded"),
    );
  };
  const handleError = (): void => settle("failed");

  image.addEventListener("load", handleLoad);
  image.addEventListener("error", handleError);
  return {
    cancel: () => settle("cancelled"),
    promise,
  };
}
