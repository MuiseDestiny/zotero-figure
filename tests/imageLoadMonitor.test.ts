import * as assert from "node:assert/strict";
import test from "node:test";
import { monitorImageLoad } from "../src/features/reader/imageLoadMonitor";

test("settles on load without waiting for Firefox image decoding", async () => {
  const image = new FakeImage();
  const monitor = monitorImageLoad(image as unknown as HTMLImageElement);

  image.dispatchEvent(new Event("load"));
  assert.equal(await monitor.promise, "loaded");
  assert.equal(image.decodeCalls, 0);
});

test("reports image failures and lets a remount cancel a pending load", async () => {
  const failedImage = new FakeImage();
  const failed = monitorImageLoad(failedImage as unknown as HTMLImageElement);
  failedImage.dispatchEvent(new Event("error"));
  assert.equal(await failed.promise, "failed");

  const cancelledImage = new FakeImage();
  const cancelled = monitorImageLoad(
    cancelledImage as unknown as HTMLImageElement,
  );
  cancelled.cancel();
  cancelledImage.dispatchEvent(new Event("load"));
  assert.equal(await cancelled.promise, "cancelled");
});

class FakeImage extends EventTarget {
  public decodeCalls = 0;

  public decode(): Promise<void> {
    this.decodeCalls++;
    return new Promise<void>(() => {});
  }
}
