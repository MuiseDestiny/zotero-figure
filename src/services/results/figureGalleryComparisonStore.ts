import { clearPref, getPref } from "../../utils/prefs";

export type StoredComparisonLayouts = Record<string, unknown>;

const STORE_DIRECTORY = "zotero-figure";
const STORE_FILE = "comparison-layouts.json";
const FLUSH_DELAY_MS = 500;

let cache: StoredComparisonLayouts = {};
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: Promise<void> | undefined;
let dirty = false;
let writable = false;
let clearLegacyAfterWrite = false;

/**
 * Loads comparison layouts into memory, migrating the legacy preference the
 * first time the store runs.
 *
 * Layouts grow with the library: one cell per figure per document, so a few
 * hundred documents already serialize to megabytes. Gecko rejects preference
 * values above 1MB outright (`MAX_PREF_LENGTH`) and takes an extra, failure
 * prone code path above 4KB (`MAX_ADVISABLE_PREF_LENGTH`), which is why this
 * lives in the data directory instead.
 */
export async function loadComparisonLayouts(): Promise<void> {
  cancelScheduledFlush();
  cache = {};
  dirty = false;
  writable = false;
  clearLegacyAfterWrite = false;
  try {
    const path = storePath();
    if (await IOUtils.exists(path)) {
      const stored = parseLayouts(await IOUtils.readUTF8(path));
      if (!stored) throw new Error(`Invalid comparison layout file: ${path}`);
      cache = stored;
    } else {
      const legacy = readLegacyPreference();
      cache = legacy ?? {};
      dirty = !!legacy;
      clearLegacyAfterWrite = !!legacy;
    }
    writable = true;
  } catch (error) {
    // Keep an unreadable file intact. Other plugin features can still start,
    // but a newly generated empty layout must never overwrite the user's data.
    logStoreError(error);
    return;
  }
  // A failed migration retains both the legacy preference and the dirty cache
  // so a later edit or shutdown can retry without preventing plugin startup.
  await flushComparisonLayouts().catch(logStoreError);
}

export function readComparisonLayouts(): StoredComparisonLayouts {
  return cache;
}

export function writeComparisonLayouts(layouts: StoredComparisonLayouts): void {
  if (!writable) {
    throw new Error(
      "Comparison layout storage is unavailable; existing data has been preserved",
    );
  }
  cache = layouts;
  dirty = true;
  cancelScheduledFlush();
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushComparisonLayouts().catch(logStoreError);
  }, FLUSH_DELAY_MS);
}

/** Writes any pending layout changes immediately, e.g. during shutdown. */
export function flushComparisonLayouts(): Promise<void> {
  cancelScheduledFlush();
  if (pendingWrite) return pendingWrite;
  if (!dirty && !clearLegacyAfterWrite) return Promise.resolve();
  pendingWrite = drainWrites().finally(() => {
    pendingWrite = undefined;
  });
  return pendingWrite;
}

async function drainWrites(): Promise<void> {
  // One writer owns the temporary file. Include edits made while I/O is in
  // flight, and mark the cache clean only after each snapshot is committed.
  while (dirty) {
    cancelScheduledFlush();
    dirty = false;
    try {
      await writeStoreFile(JSON.stringify(cache));
    } catch (error) {
      dirty = true;
      throw error;
    }
  }
  if (clearLegacyAfterWrite) {
    clearPref("galleryComparisonLayouts");
    clearLegacyAfterWrite = false;
  }
}

function cancelScheduledFlush(): void {
  if (flushTimer === undefined) return;
  clearTimeout(flushTimer);
  flushTimer = undefined;
}

function readLegacyPreference(): StoredComparisonLayouts | undefined {
  const serialized = getPref("galleryComparisonLayouts");
  return serialized ? parseLayouts(serialized) : undefined;
}

function parseLayouts(serialized: string): StoredComparisonLayouts | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function storeDirectory(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, STORE_DIRECTORY);
}

function storePath(): string {
  return PathUtils.join(storeDirectory(), STORE_FILE);
}

async function writeStoreFile(serialized: string): Promise<void> {
  const path = storePath();
  const temporaryPath = `${path}.tmp`;
  await IOUtils.makeDirectory(storeDirectory(), {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeUTF8(temporaryPath, serialized, { flush: true });
  await IOUtils.move(temporaryPath, path, { noOverwrite: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logStoreError(value: unknown): void {
  Zotero.logError(value instanceof Error ? value : new Error(String(value)));
}
