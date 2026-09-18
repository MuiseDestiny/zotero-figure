import { clearPref, getPref } from "../../utils/prefs";

export type StoredComparisonLayouts = Record<string, unknown>;

const STORE_DIRECTORY = "zotero-figure";
const STORE_FILE = "comparison-layouts.json";
const FLUSH_DELAY_MS = 500;

let cache: StoredComparisonLayouts = {};
let flushTimer: ReturnType<typeof setTimeout> | undefined;

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
  const path = storePath();
  if (await IOUtils.exists(path)) {
    const stored = parseLayouts(await IOUtils.readUTF8(path));
    if (stored) {
      cache = stored;
      return;
    }
  }
  const legacy = readLegacyPreference();
  cache = legacy ?? {};
  if (!legacy) return;
  await writeStoreFile();
  clearPref("galleryComparisonLayouts");
}

export function readComparisonLayouts(): StoredComparisonLayouts {
  return cache;
}

export function writeComparisonLayouts(layouts: StoredComparisonLayouts): void {
  cache = layouts;
  cancelScheduledFlush();
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void writeStoreFile().catch((error: unknown) =>
      Zotero.logError(toError(error)),
    );
  }, FLUSH_DELAY_MS);
}

/** Writes any pending layout changes immediately, e.g. during shutdown. */
export async function flushComparisonLayouts(): Promise<void> {
  if (flushTimer === undefined) return;
  cancelScheduledFlush();
  await writeStoreFile();
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

async function writeStoreFile(): Promise<void> {
  const path = storePath();
  const temporaryPath = `${path}.tmp`;
  await IOUtils.makeDirectory(storeDirectory(), {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeUTF8(temporaryPath, JSON.stringify(cache));
  await IOUtils.move(temporaryPath, path, { noOverwrite: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
