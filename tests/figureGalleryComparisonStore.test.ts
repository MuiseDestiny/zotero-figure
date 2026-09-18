import * as assert from "node:assert/strict";
import test from "node:test";
import { registerApplicationShutdownTask } from "../src/platform/zotero/applicationShutdown";
import {
  flushComparisonLayouts,
  loadComparisonLayouts,
  readComparisonLayouts,
  writeComparisonLayouts,
} from "../src/services/results/figureGalleryComparisonStore";
import { installMemoryIO, type MemoryIOHarness } from "./helpers/memoryIO";

const STORE_PATH = "/data/zotero-figure/comparison-layouts.json";

interface StoreHarness {
  errors: Error[];
  fireTimer(): void;
  io: MemoryIOHarness;
  prefs: Map<string, unknown>;
  restore(): void;
  shutdown(): Promise<void>;
}

function installStore(): StoreHarness {
  const previousZotero = globalThis.Zotero;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const io = installMemoryIO();
  const prefs = new Map<string, unknown>();
  const errors: Error[] = [];
  const shutdownTasks: Array<() => Promise<void>> = [];
  const timers = new Map<number, () => void>();
  let timerID = 0;
  globalThis.setTimeout = ((callback: () => void) => {
    timers.set(++timerID, callback);
    return timerID;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    timers.delete(id);
  }) as unknown as typeof clearTimeout;
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    Prefs: {
      clear: (key: string) => prefs.delete(key),
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
    addShutdownListener: (task: () => Promise<void>) =>
      shutdownTasks.push(task),
    logError: (error: Error) => errors.push(error),
  } as unknown as typeof Zotero;
  return {
    errors,
    fireTimer: () => {
      assert.equal(timers.size, 1);
      const [id, callback] = [...timers][0];
      timers.delete(id);
      callback();
    },
    io,
    prefs,
    restore: () => {
      io.restore();
      globalThis.Zotero = previousZotero;
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
    },
    shutdown: async () => {
      await Promise.all(shutdownTasks.map((task) => task()));
    },
  };
}

test("keeps comparison layouts in the data directory rather than a preference", async () => {
  const harness = installStore();
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), {});

    writeComparisonLayouts({ "1": { version: 3 } });
    assert.deepEqual(readComparisonLayouts(), { "1": { version: 3 } });

    await flushComparisonLayouts();
    assert.equal(
      harness.io.readText(STORE_PATH),
      JSON.stringify({ "1": { version: 3 } }),
    );
    assert.equal(harness.prefs.size, 0);

    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), { "1": { version: 3 } });
  } finally {
    harness.restore();
  }
});

test("migrates a legacy preference payload and clears the preference", async () => {
  const harness = installStore();
  const legacy = { "1": { documentOrder: [3, 1], rows: [], version: 3 } };
  harness.prefs.set(
    "extensions.zotero.zoterofigure.galleryComparisonLayouts",
    JSON.stringify(legacy),
  );
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), legacy);
    assert.equal(harness.io.readText(STORE_PATH), JSON.stringify(legacy));
    assert.equal(harness.prefs.size, 0);
  } finally {
    harness.restore();
  }
});

test("preserves malformed layouts and prevents an empty replacement", async () => {
  const harness = installStore();
  harness.io.writeText(STORE_PATH, "not json");
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), {});
    assert.throws(() => writeComparisonLayouts({}), /storage is unavailable/);
    await flushComparisonLayouts();
    assert.equal(harness.io.readText(STORE_PATH), "not json");
    assert.equal(harness.errors.length, 1);
  } finally {
    harness.restore();
  }
});

test("coalesces edits into one debounced disk write", async () => {
  const harness = installStore();
  try {
    await loadComparisonLayouts();
    writeComparisonLayouts({ "1": { label: "first" } });
    writeComparisonLayouts({ "1": { label: "latest" } });
    assert.equal(harness.io.exists(STORE_PATH), false);
    harness.fireTimer();
    await settle();
    assert.equal(harness.io.operations.textWrites.length, 1);
    assert.equal(
      harness.io.readText(STORE_PATH),
      JSON.stringify({ "1": { label: "latest" } }),
    );
  } finally {
    harness.restore();
  }
});

test("flush waits for an active write and serializes edits received during it", async () => {
  const harness = installStore();
  const entered = deferred();
  const release = deferred();
  const move = IOUtils.move;
  let moves = 0;
  IOUtils.move = async (...args) => {
    if (++moves === 1) {
      entered.resolve();
      await release.promise;
    }
    return move(...args);
  };
  try {
    await loadComparisonLayouts();
    writeComparisonLayouts({ "1": { label: "first" } });
    harness.fireTimer();
    await entered.promise;
    const flushing = flushComparisonLayouts();
    let finished = false;
    void flushing.then(() => {
      finished = true;
    });
    writeComparisonLayouts({
      "1": { label: "latest" },
      "2": { label: "other library" },
    });
    assert.equal(flushComparisonLayouts(), flushing);
    await settle();
    assert.equal(finished, false);
    assert.equal(
      harness.io.operations.textWrites.length,
      1,
      "the shared temporary file must have only one writer",
    );
    release.resolve();
    await flushing;
    assert.deepEqual(JSON.parse(harness.io.readText(STORE_PATH)!), {
      "1": { label: "latest" },
      "2": { label: "other library" },
    });
    assert.equal(moves, 2);
    assert.equal(harness.io.exists(`${STORE_PATH}.tmp`), false);
  } finally {
    release.resolve();
    await flushComparisonLayouts();
    harness.restore();
  }
});

test("retries a failed background write when shutdown flushes", async () => {
  const harness = installStore();
  const write = IOUtils.writeUTF8;
  try {
    await loadComparisonLayouts();
    IOUtils.writeUTF8 = async () => {
      throw new Error("temporary write failure");
    };
    writeComparisonLayouts({ "1": { label: "latest" } });
    harness.fireTimer();
    await settle();
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.io.exists(STORE_PATH), false);
    IOUtils.writeUTF8 = write;
    await flushComparisonLayouts();
    assert.equal(
      harness.io.readText(STORE_PATH),
      JSON.stringify({ "1": { label: "latest" } }),
    );
  } finally {
    IOUtils.writeUTF8 = write;
    harness.restore();
  }
});

test("preserves the committed file on a failed rename and retries the latest edit", async () => {
  const harness = installStore();
  const move = IOUtils.move;
  const original = JSON.stringify({ "1": { label: "original" } });
  harness.io.writeText(STORE_PATH, original);
  try {
    await loadComparisonLayouts();
    IOUtils.move = async () => {
      throw new Error("temporary rename failure");
    };
    writeComparisonLayouts({ "1": { label: "new" } });
    await assert.rejects(flushComparisonLayouts(), /rename failure/);
    assert.equal(harness.io.readText(STORE_PATH), original);
    writeComparisonLayouts({ "1": { label: "latest" } });
    IOUtils.move = move;
    await flushComparisonLayouts();
    assert.equal(
      harness.io.readText(STORE_PATH),
      JSON.stringify({ "1": { label: "latest" } }),
    );
  } finally {
    IOUtils.move = move;
    harness.restore();
  }
});

test("keeps the legacy preference until a failed migration has been retried successfully", async () => {
  const harness = installStore();
  const write = IOUtils.writeUTF8;
  const legacy = { "1": { documentOrder: [3, 1], rows: [], version: 3 } };
  const key = "extensions.zotero.zoterofigure.galleryComparisonLayouts";
  harness.prefs.set(key, JSON.stringify(legacy));
  try {
    IOUtils.writeUTF8 = async () => {
      throw new Error("disk full");
    };
    await assert.doesNotReject(loadComparisonLayouts());
    assert.deepEqual(readComparisonLayouts(), legacy);
    assert.equal(harness.prefs.has(key), true);
    assert.equal(harness.errors.length, 1);
    IOUtils.writeUTF8 = write;
    await flushComparisonLayouts();
    assert.equal(harness.io.readText(STORE_PATH), JSON.stringify(legacy));
    assert.equal(harness.prefs.has(key), false);
  } finally {
    IOUtils.writeUTF8 = write;
    harness.restore();
  }
});

for (const operation of ["exists", "readUTF8"] as const) {
  test(`continues startup without overwriting layouts when ${operation} fails`, async () => {
    const harness = installStore();
    const original = JSON.stringify({ "1": { label: "saved" } });
    harness.io.writeText(STORE_PATH, original);
    IOUtils[operation] = async () => {
      throw new Error("permission denied");
    };
    try {
      await assert.doesNotReject(loadComparisonLayouts());
      assert.equal(harness.errors.length, 1);
      assert.throws(() => writeComparisonLayouts({}), /storage is unavailable/);
      await flushComparisonLayouts();
      assert.equal(harness.io.readText(STORE_PATH), original);
    } finally {
      harness.restore();
    }
  });
}

test("application exit flushes before the timer fires and disabled callbacks cannot save", async () => {
  const harness = installStore();
  const unregister = registerApplicationShutdownTask(flushComparisonLayouts);
  try {
    await loadComparisonLayouts();
    writeComparisonLayouts({ "1": { label: "saved at exit" } });
    await harness.shutdown();
    const saved = harness.io.readText(STORE_PATH);
    assert.equal(saved, JSON.stringify({ "1": { label: "saved at exit" } }));
    unregister();
    writeComparisonLayouts({ "1": { label: "disabled" } });
    await harness.shutdown();
    assert.equal(harness.io.readText(STORE_PATH), saved);
    await flushComparisonLayouts();
  } finally {
    unregister();
    harness.restore();
  }
});

test("a failed save does not reject Zotero's application shutdown", async () => {
  const harness = installStore();
  const write = IOUtils.writeUTF8;
  const unregister = registerApplicationShutdownTask(flushComparisonLayouts);
  try {
    await loadComparisonLayouts();
    IOUtils.writeUTF8 = async () => {
      throw new Error("disk full");
    };
    writeComparisonLayouts({ "1": { label: "pending" } });
    await assert.doesNotReject(harness.shutdown());
    assert.equal(harness.errors.length, 1);
    IOUtils.writeUTF8 = write;
    await flushComparisonLayouts();
  } finally {
    unregister();
    IOUtils.writeUTF8 = write;
    harness.restore();
  }
});

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("persists layouts far larger than the Gecko preference ceiling", async () => {
  const harness = installStore();
  try {
    await loadComparisonLayouts();
    // One cell per figure per document; a few hundred documents already
    // exceeds MAX_PREF_LENGTH (1MB), which is why this is not a preference.
    const rows = Array.from({ length: 2000 }, (_unused, row) => ({
      entries: Object.fromEntries(
        Array.from({ length: 40 }, (_cell, column) => [
          String(column),
          {
            entryIDs: [`1:KEY${column}:${row}`],
            primaryEntryID: `1:KEY${column}:${row}`,
          },
        ]),
      ),
      id: `comparison-row-${row}`,
      isGroup: false,
      label: "",
    }));
    writeComparisonLayouts({
      "1": { documentOrder: [1], rows, version: 3 },
    });
    await flushComparisonLayouts();

    const serialized = harness.io.readText(STORE_PATH);
    assert.ok(serialized, "expected the store file to exist");
    assert.ok(
      serialized.length > 1024 * 1024,
      `expected a payload above 1MB, saw ${serialized.length}`,
    );
    assert.equal(harness.prefs.size, 0);
  } finally {
    harness.restore();
  }
});
