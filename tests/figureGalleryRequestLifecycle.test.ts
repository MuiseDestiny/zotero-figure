import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGallerySnapshot } from "../src/domain/figureGallery";
import { GalleryLibraryLoadCoordinator } from "../src/features/gallery/galleryLibraryLoadCoordinator";

test("only the newest gallery load can commit or enable controls", async () => {
  const snapshotRequests = [
    createDeferred<FigureGallerySnapshot>(),
    createDeferred<FigureGallerySnapshot>(),
  ];
  const filterRequests = [createDeferred<object>(), createDeferred<object>()];
  const disabledStates: boolean[] = [];
  const committed: string[] = [];
  const errors: unknown[] = [];
  let filterRequestIndex = 0;
  let snapshotRequestIndex = 0;
  let loadingCount = 0;
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: () => filterRequests[filterRequestIndex++].promise,
    commit: (snapshot) => committed.push(snapshot.generatedAt),
    isSelectedLibrary: () => true,
    loadSnapshot: async () =>
      await snapshotRequests[snapshotRequestIndex++].promise,
    reportError: (error) => errors.push(error),
    setControlsDisabled: (disabled) => disabledStates.push(disabled),
    showLoading: () => loadingCount++,
  });

  const older = coordinator.load(1);
  snapshotRequests[0].resolve(snapshot("old"));
  await waitFor(() => filterRequestIndex === 1);

  const newer = coordinator.load(1);
  snapshotRequests[1].resolve(snapshot("new"));
  await waitFor(() => filterRequestIndex === 2);

  filterRequests[0].resolve({});
  await older;
  assert.deepEqual(disabledStates, [true, true]);
  assert.deepEqual(committed, []);

  filterRequests[1].resolve({});
  await newer;
  assert.deepEqual(disabledStates, [true, true, false]);
  assert.deepEqual(committed, ["new"]);
  assert.deepEqual(errors, []);
  assert.equal(loadingCount, 2);
});

test("a failed superseded gallery load cannot replace current state", async () => {
  const older = createDeferred<FigureGallerySnapshot>();
  const errors: unknown[] = [];
  const committed: string[] = [];
  let requestCount = 0;
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: async () => ({}),
    commit: (snapshot) => committed.push(snapshot.generatedAt),
    isSelectedLibrary: () => true,
    loadSnapshot: async () => {
      if (requestCount++ === 0) return await older.promise;
      return snapshot("new");
    },
    reportError: (error) => errors.push(error),
    setControlsDisabled: () => undefined,
    showLoading: () => undefined,
  });

  const oldRequest = coordinator.load(1);
  await coordinator.load(1);
  older.reject(new Error("old request failed"));
  await oldRequest;

  assert.deepEqual(committed, ["new"]);
  assert.deepEqual(errors, []);
});

test("cancelling the gallery loader invalidates pending view work", async () => {
  const pending = createDeferred<FigureGallerySnapshot>();
  let committed = false;
  let reported = false;
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: async () => ({}),
    commit: () => {
      committed = true;
    },
    isSelectedLibrary: () => true,
    loadSnapshot: async () => await pending.promise,
    reportError: () => {
      reported = true;
    },
    setControlsDisabled: () => undefined,
    showLoading: () => undefined,
  });

  const request = coordinator.load(1);
  coordinator.cancel();
  pending.resolve(snapshot("late"));
  await request;

  assert.equal(committed, false);
  assert.equal(reported, false);
});

test("merges live updates received throughout a pending gallery load", async () => {
  const snapshotRequest = createDeferred<FigureGallerySnapshot>();
  const filterRequest = createDeferred<object>();
  let committed = "";
  let filterStarted = false;
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: async () => {
      filterStarted = true;
      return await filterRequest.promise;
    },
    commit: (loaded) => {
      committed = loaded.generatedAt;
    },
    isSelectedLibrary: () => true,
    loadSnapshot: async () => await snapshotRequest.promise,
    reportError: (error) => assert.fail(String(error)),
    setControlsDisabled: () => undefined,
    showLoading: () => undefined,
  });

  const request = coordinator.load(1);
  coordinator.updatePendingSnapshot((loaded) => {
    loaded.generatedAt += ":before-snapshot";
  });
  snapshotRequest.resolve(snapshot("base"));
  await waitFor(() => filterStarted);
  coordinator.updatePendingSnapshot((loaded) => {
    loaded.generatedAt += ":before-commit";
  });
  filterRequest.resolve({});
  await request;

  assert.equal(committed, "base:before-snapshot:before-commit");
});

test("reports a current refresh failure with its library identity", async () => {
  const error = new Error("manifest could not be read");
  const reported: Array<{ error: unknown; libraryID: number }> = [];
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: async () => ({}),
    commit: () => undefined,
    isSelectedLibrary: () => true,
    loadSnapshot: async () => {
      throw error;
    },
    reportError: (reportedError, libraryID) => {
      reported.push({ error: reportedError, libraryID });
    },
    setControlsDisabled: () => undefined,
    showLoading: () => undefined,
  });

  await coordinator.load(7);

  assert.deepEqual(reported, [{ error, libraryID: 7 }]);
});

test("reports a post-index failure with the loaded snapshot", async () => {
  const error = new Error("filter localization failed");
  const loaded = snapshot("new-index");
  const reported: Array<{
    error: unknown;
    libraryID: number;
    loadedSnapshot?: FigureGallerySnapshot;
  }> = [];
  const coordinator = new GalleryLibraryLoadCoordinator({
    buildFilterOptions: async () => {
      throw error;
    },
    commit: () => undefined,
    isSelectedLibrary: () => true,
    loadSnapshot: async () => loaded,
    reportError: (reportedError, libraryID, loadedSnapshot) => {
      reported.push({ error: reportedError, libraryID, loadedSnapshot });
    },
    setControlsDisabled: () => undefined,
    showLoading: () => undefined,
  });

  await coordinator.load(1);

  assert.deepEqual(reported, [{ error, libraryID: 1, loadedSnapshot: loaded }]);
});

function snapshot(id: string): FigureGallerySnapshot {
  return { entries: [], generatedAt: id, libraryID: 1 };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for gallery request state");
}
