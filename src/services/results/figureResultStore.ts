import {
  createFigureResultRecord,
  getFigureResultFingerprint,
  getFigureResultImageFingerprint,
  getFigureResultID,
  getFigureResultKind,
  type FigureResultAnalysisIdentity,
  type FigureResultRecord,
} from "../../domain/figureResults";
import type { AnnotationCandidate, Rect } from "../../domain/layout";
import type { DuplicateMode } from "../../platform/zotero/annotations";
import { OperationCancelledError } from "../../utils/cancellation";
import { RECOMMENDED_MODEL } from "../model/modelCatalog";

const SCHEMA_VERSION = 5;
const PREVIOUS_SCHEMA_VERSION = 4;
const IMAGE_CACHE_SCHEMA_VERSION = 3;
const TRANSLATION_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const ROOT_DIRECTORY = "zotero-figure/results";
const attachmentLocks = new Map<string, AttachmentLockState>();

export const DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY: FigureResultAnalysisIdentity =
  Object.freeze({
    analysisVersion: 4,
    modelHash: RECOMMENDED_MODEL.sha256,
    previewVersion: "mupdf-region-v1",
  });

export interface FigureResultTranslation {
  source: string;
  text: string;
  translatedAt: string;
}

export interface FigureResultTranslationUpdate {
  id: string;
  source: string;
  text: string;
}

type FigureResultTranslationContexts = Record<string, FigureResultTranslation>;
type FigureResultTranslationCache = Record<
  string,
  FigureResultTranslationContexts
>;

interface FigureResultImageCacheEntry extends FigureResultAnalysisIdentity {
  fingerprint: string;
  sourceFingerprint: string;
}

type FigureResultImageCache = Record<string, FigureResultImageCacheEntry>;

interface FigureResultManifest {
  analysisIdentity?: FigureResultAnalysisIdentity;
  attachmentKey: string;
  imageCache: FigureResultImageCache;
  libraryID: number;
  results: FigureResultRecord[];
  schemaVersion: number;
  translations: FigureResultTranslationCache;
  updatedAt: string;
}

interface AttachmentLockWaiter {
  abort?: () => void;
  reject(error: Error): void;
  resolve(release: () => void): void;
  signal?: AbortSignal;
}

interface AttachmentLockState {
  active: boolean;
  waiters: AttachmentLockWaiter[];
}

export interface FigureResultStoreOptions {
  analysisIdentity?: FigureResultAnalysisIdentity;
}

export interface StoredFigureResult extends FigureResultRecord {
  imagePath: string;
}

export interface FigureResultStoreReconcile {
  created: number;
  removed: number;
  results: StoredFigureResult[];
  skipped: number;
  timings: FigureResultStoreTimings;
}

export interface FigureResultStoreTimings {
  imageWriteMs: number;
  lockWaitMs: number;
  manifestWriteMs: number;
}

export class FigureResultStore {
  private readonly analysisIdentity: FigureResultAnalysisIdentity;

  constructor(options: FigureResultStoreOptions = {}) {
    this.analysisIdentity = normalizeAnalysisIdentity(
      options.analysisIdentity ?? DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
    );
  }

  public async list(item: Zotero.Item): Promise<StoredFigureResult[]> {
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      return manifest.results.map((result) => this.withImagePath(item, result));
    } finally {
      release();
    }
  }

  public async listIndexedAttachmentKeys(libraryID: number): Promise<string[]> {
    if (!Number.isInteger(libraryID) || libraryID < 0) {
      throw new Error("Figure result library has an invalid ID");
    }
    const directory = PathUtils.join(
      Zotero.DataDirectory.dir,
      ...ROOT_DIRECTORY.split("/"),
      String(libraryID),
    );
    if (!(await IOUtils.exists(directory))) return [];

    const children = await IOUtils.getChildren(directory);
    const keys: string[] = [];
    for (const child of children) {
      const key = PathUtils.filename(child);
      if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
      if (await IOUtils.exists(PathUtils.join(child, "manifest.json"))) {
        keys.push(key);
      }
    }
    return [...new Set(keys)].sort();
  }

  public async getReusablePageResults(
    item: Zotero.Item,
    pageIndex: number,
    candidates: readonly AnnotationCandidate[],
    signal?: AbortSignal,
    sourceFingerprint?: string,
  ): Promise<StoredFigureResult[] | undefined> {
    assertPageCandidates(pageIndex, candidates);
    const source =
      sourceFingerprint ?? (await this.getSourceFingerprint(item, signal));
    const release = await this.acquireAttachmentLock(item, signal);
    try {
      const manifest = await this.readManifest(item);
      const pageResults = manifest.results.filter(
        (result) => result.pageIndex === pageIndex,
      );
      const expectedFingerprints = [
        ...new Set(candidates.map(getFigureResultFingerprint)),
      ].sort();
      const storedFingerprints = pageResults
        .map(getFigureResultFingerprint)
        .sort();
      if (
        expectedFingerprints.length !== storedFingerprints.length ||
        !expectedFingerprints.every(
          (fingerprint, index) => fingerprint === storedFingerprints[index],
        )
      ) {
        return undefined;
      }
      for (const result of pageResults) {
        throwIfAborted(signal);
        if (
          !(await this.isReusableImage(
            item,
            manifest.imageCache,
            result,
            source,
          ))
        ) {
          return undefined;
        }
      }
      return pageResults.map((result) => this.withImagePath(item, result));
    } finally {
      release();
    }
  }

  public async getCachedTranslations(
    item: Zotero.Item,
    contextKey: string,
  ): Promise<Map<string, string>> {
    assertTranslationContextKey(contextKey);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      return getTranslationsForContext(manifest, contextKey);
    } finally {
      release();
    }
  }

  public async saveTranslations(
    item: Zotero.Item,
    contextKey: string,
    updates: readonly FigureResultTranslationUpdate[],
  ): Promise<Map<string, string>> {
    assertTranslationContextKey(contextKey);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const resultsByID = new Map(
        manifest.results.map((result) => [result.id, result]),
      );
      const translations = pruneTranslationCache(
        manifest.translations,
        manifest.results,
      );
      let changed = false;
      for (const update of updates) {
        const result = resultsByID.get(update.id);
        const text = update.text.trim();
        if (!result || result.comment !== update.source || !text) continue;
        const existing = translations[result.id]?.[contextKey];
        if (existing?.source === result.comment && existing.text === text) {
          continue;
        }
        translations[result.id] ??= {};
        translations[result.id][contextKey] = {
          source: result.comment,
          text,
          translatedAt: new Date().toISOString(),
        };
        changed = true;
      }
      if (changed || manifest.schemaVersion !== SCHEMA_VERSION) {
        await this.commit(
          item,
          manifest.results,
          translations,
          manifest.imageCache,
        );
      }
      return getTranslationsForContext(
        { ...manifest, translations },
        contextKey,
      );
    } finally {
      release();
    }
  }

  public async updateComment(
    item: Zotero.Item,
    resultID: string,
    comment: string,
  ): Promise<StoredFigureResult | undefined> {
    const normalizedComment = normalizeManualComment(comment);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const existing = manifest.results.find(
        (result) => result.id === resultID,
      );
      if (!existing) return undefined;
      if (existing.comment === normalizedComment) {
        return this.withImagePath(item, existing);
      }

      const detectedComment = existing.detectedComment ?? existing.comment;
      const base = { ...existing };
      delete base.detectedComment;
      const updated: FigureResultRecord =
        normalizedComment === detectedComment
          ? { ...base, comment: normalizedComment }
          : { ...base, comment: normalizedComment, detectedComment };
      const results = manifest.results.map((result) =>
        result.id === resultID ? updated : result,
      );
      const translations = pruneTranslationCache(
        manifest.translations,
        manifest.results,
      );
      delete translations[resultID];
      await this.commit(item, results, translations, manifest.imageCache);
      return this.withImagePath(item, updated);
    } finally {
      release();
    }
  }

  public async updateRegion(
    item: Zotero.Item,
    resultID: string,
    rect: readonly number[],
    image: ArrayBuffer,
  ): Promise<StoredFigureResult | undefined> {
    const normalizedRect = normalizeResultRect(rect);
    if (!(image instanceof ArrayBuffer) || image.byteLength === 0) {
      throw new Error("Corrected figure result image is empty");
    }
    const sourceFingerprint = await this.getSourceFingerprint(item);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const existing = manifest.results.find(({ id }) => id === resultID);
      if (!existing) return undefined;
      const detectedRect = existing.detectedRect ?? existing.rect;
      const base = { ...existing, rect: normalizedRect };
      delete base.detectedRect;
      const updated: FigureResultRecord = resultRectsMatch(
        normalizedRect,
        detectedRect,
      )
        ? base
        : { ...base, detectedRect: [...detectedRect] as Rect };
      const previousImage = await readOptionalImage(
        this.getResultPath(item, existing),
      );
      await this.writeImage(item, updated, image);
      const results = manifest.results.map((result) =>
        result.id === resultID ? updated : result,
      );
      const imageCache = {
        ...manifest.imageCache,
        [resultID]: this.createImageCacheEntry(updated, sourceFingerprint),
      };
      try {
        await this.commit(
          item,
          results,
          manifest.translations,
          imageCache,
          true,
        );
      } catch (error) {
        if (previousImage) {
          await this.writeImage(item, existing, previousImage);
        } else {
          await this.removeImage(item, existing);
        }
        throw error;
      }
      return this.withImagePath(item, updated);
    } finally {
      release();
    }
  }

  public async reconcilePage(
    item: Zotero.Item,
    pageIndex: number,
    candidates: readonly AnnotationCandidate[],
    images: readonly ArrayBuffer[],
    mode: DuplicateMode,
    signal?: AbortSignal,
    sourceFingerprint?: string,
  ): Promise<FigureResultStoreReconcile> {
    if (candidates.length !== images.length) {
      throw new Error("Figure result images do not match detected candidates");
    }
    assertPageCandidates(pageIndex, candidates);
    throwIfAborted(signal);
    const source =
      sourceFingerprint ?? (await this.getSourceFingerprint(item, signal));
    const timings: FigureResultStoreTimings = {
      imageWriteMs: 0,
      lockWaitMs: 0,
      manifestWriteMs: 0,
    };
    const lockStartedAt = Date.now();
    const release = await this.acquireAttachmentLock(item, signal);
    timings.lockWaitMs = Date.now() - lockStartedAt;
    try {
      const result = await this.reconcilePageUnlocked(
        item,
        pageIndex,
        candidates,
        images,
        mode,
        timings,
        source,
        signal,
      );
      return { ...result, timings };
    } finally {
      release();
    }
  }

  private async reconcilePageUnlocked(
    item: Zotero.Item,
    pageIndex: number,
    candidates: readonly AnnotationCandidate[],
    images: readonly ArrayBuffer[],
    mode: DuplicateMode,
    timings: FigureResultStoreTimings,
    sourceFingerprint: string,
    signal?: AbortSignal,
  ): Promise<Omit<FigureResultStoreReconcile, "timings">> {
    const entries = getUniqueCandidateEntries(candidates, images);
    const duplicateCandidates = candidates.length - entries.length;
    const manifest = await this.readManifest(item);
    const imageCache = pruneImageCache(manifest.imageCache, manifest.results);
    const existingPage = manifest.results.filter(
      (result) => result.pageIndex === pageIndex,
    );
    const otherResults = manifest.results.filter(
      (result) => result.pageIndex !== pageIndex,
    );
    const existingByFingerprint = new Map(
      existingPage.map((result) => [
        getFigureResultFingerprint(result),
        result,
      ]),
    );
    const existingByID = new Map(
      manifest.results.map((result) => [result.id, result]),
    );
    const createdRecords: FigureResultRecord[] = [];
    let directoryReady = false;
    let imageCacheChanged = false;
    let skipped = duplicateCandidates;
    const ensureDirectory = async () => {
      if (directoryReady) return;
      await IOUtils.makeDirectory(this.getImagesDirectory(item), {
        createAncestors: true,
        ignoreExisting: true,
      });
      directoryReady = true;
    };
    const writeCurrentImage = async (
      result: FigureResultRecord,
      image: ArrayBuffer,
    ) => {
      const startedAt = Date.now();
      try {
        await ensureDirectory();
        await this.writeImage(item, result, image);
      } finally {
        timings.imageWriteMs += Date.now() - startedAt;
      }
      imageCache[result.id] = this.createImageCacheEntry(
        result,
        sourceFingerprint,
      );
      imageCacheChanged = true;
    };

    if (mode === "skip-existing") {
      let committed = false;
      try {
        for (const entry of entries) {
          throwIfAborted(signal);
          const existing = existingByFingerprint.get(entry.fingerprint);
          if (existing) {
            skipped++;
            if (
              !(await this.isReusableImage(
                item,
                imageCache,
                existing,
                sourceFingerprint,
              ))
            ) {
              await writeCurrentImage(existing, entry.image);
            }
            continue;
          }
          const record = this.createRecord(entry.candidate);
          assertResultIDAvailable(record, entry.fingerprint, existingByID);
          await writeCurrentImage(record, entry.image);
          createdRecords.push(record);
          existingByID.set(record.id, record);
        }
        throwIfAborted(signal);
        const results = [...manifest.results, ...createdRecords];
        if (
          createdRecords.length > 0 ||
          imageCacheChanged ||
          manifest.schemaVersion !== SCHEMA_VERSION
        ) {
          await this.commit(
            item,
            results,
            pruneTranslationCache(manifest.translations, results),
            pruneImageCache(imageCache, results),
            directoryReady,
            timings,
          );
        }
        committed = true;
        return {
          created: createdRecords.length,
          removed: 0,
          results: results.map((result) => this.withImagePath(item, result)),
          skipped,
        };
      } catch (error) {
        if (!committed) await this.removeImages(item, createdRecords);
        throw error;
      }
    }

    const existingFingerprints = existingPage
      .map((result) => getFigureResultFingerprint(result))
      .sort();
    const candidateFingerprints = entries
      .map((entry) => entry.fingerprint)
      .sort();
    const candidatesMatch =
      existingFingerprints.length === candidateFingerprints.length &&
      existingFingerprints.every(
        (fingerprint, index) => fingerprint === candidateFingerprints[index],
      );
    if (candidatesMatch) {
      for (const entry of entries) {
        throwIfAborted(signal);
        const existing = existingByFingerprint.get(entry.fingerprint);
        if (
          existing &&
          !(await this.isReusableImage(
            item,
            imageCache,
            existing,
            sourceFingerprint,
          ))
        ) {
          await writeCurrentImage(existing, entry.image);
        }
      }
      if (imageCacheChanged || manifest.schemaVersion !== SCHEMA_VERSION) {
        await this.commit(
          item,
          manifest.results,
          manifest.translations,
          pruneImageCache(imageCache, manifest.results),
          directoryReady,
          timings,
        );
      }
      skipped = candidates.length;
      return {
        created: 0,
        removed: 0,
        results: manifest.results.map((result) =>
          this.withImagePath(item, result),
        ),
        skipped,
      };
    }

    const newImageRecords: FigureResultRecord[] = [];
    let committed = false;
    try {
      for (const entry of entries) {
        throwIfAborted(signal);
        const matchingExisting = existingByFingerprint.get(entry.fingerprint);
        const detectedRecord = this.createRecord(entry.candidate);
        const record = matchingExisting
          ? preserveManualOverrides(detectedRecord, matchingExisting)
          : detectedRecord;
        assertResultIDAvailable(record, entry.fingerprint, existingByID);
        if (
          !matchingExisting ||
          !(await this.isReusableImage(
            item,
            imageCache,
            matchingExisting,
            sourceFingerprint,
          ))
        ) {
          await writeCurrentImage(record, entry.image);
        }
        createdRecords.push(record);
        if (!existingByID.has(record.id) && !matchingExisting) {
          newImageRecords.push(record);
        }
        existingByID.set(record.id, record);
      }
      throwIfAborted(signal);
      const results = [...otherResults, ...createdRecords];
      await this.commit(
        item,
        results,
        pruneTranslationCache(manifest.translations, results),
        pruneImageCache(imageCache, results),
        directoryReady,
        timings,
      );
      committed = true;
      await this.removeObsoleteImages(item, existingPage, results);
      return {
        created: createdRecords.length,
        removed: existingPage.length,
        results: results.map((result) => this.withImagePath(item, result)),
        skipped: duplicateCandidates,
      };
    } catch (error) {
      if (!committed) await this.removeImages(item, newImageRecords);
      throw error;
    }
  }

  public async remove(
    item: Zotero.Item,
    resultID: string,
  ): Promise<StoredFigureResult | undefined> {
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const removed = manifest.results.find((result) => result.id === resultID);
      if (!removed) return undefined;
      const results = manifest.results.filter(
        (result) => result.id !== resultID,
      );
      await this.commit(
        item,
        results,
        pruneTranslationCache(manifest.translations, results),
        pruneImageCache(manifest.imageCache, results),
      );
      await this.removeImages(item, [removed]);
      return this.withImagePath(item, removed);
    } finally {
      release();
    }
  }

  public async clear(item: Zotero.Item): Promise<StoredFigureResult[]> {
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const results = manifest.results.map((result) =>
        this.withImagePath(item, result),
      );
      await IOUtils.remove(this.getAttachmentDirectory(item), {
        ignoreAbsent: true,
        recursive: true,
      });
      return results;
    } finally {
      release();
    }
  }

  private createRecord(candidate: AnnotationCandidate): FigureResultRecord {
    const id = this.createRecordID(candidate);
    return createFigureResultRecord(candidate, `images/${id}.png`);
  }

  private createRecordID(candidate: AnnotationCandidate): string {
    return getFigureResultID(candidate);
  }

  private async readManifest(item: Zotero.Item): Promise<FigureResultManifest> {
    const path = this.getManifestPath(item);
    if (!(await IOUtils.exists(path))) return this.emptyManifest(item);
    let value: Partial<FigureResultManifest>;
    try {
      value = JSON.parse(
        await IOUtils.readUTF8(path),
      ) as Partial<FigureResultManifest>;
    } catch {
      return this.emptyManifest(item);
    }
    if (
      typeof value.schemaVersion === "number" &&
      value.schemaVersion > SCHEMA_VERSION
    ) {
      throw new Error(
        `Figure result manifest schema ${value.schemaVersion} is newer than supported schema ${SCHEMA_VERSION}`,
      );
    }
    if (
      (value.schemaVersion !== LEGACY_SCHEMA_VERSION &&
        value.schemaVersion !== TRANSLATION_SCHEMA_VERSION &&
        value.schemaVersion !== IMAGE_CACHE_SCHEMA_VERSION &&
        value.schemaVersion !== PREVIOUS_SCHEMA_VERSION &&
        value.schemaVersion !== SCHEMA_VERSION) ||
      value.attachmentKey !== item.key ||
      value.libraryID !== item.libraryID ||
      !Array.isArray(value.results)
    ) {
      return this.emptyManifest(item);
    }
    const results: FigureResultRecord[] = [];
    const resultIDs = new Set<string>();
    for (const candidate of value.results) {
      if (!isFigureResultRecord(candidate) || resultIDs.has(candidate.id)) {
        continue;
      }
      resultIDs.add(candidate.id);
      results.push(candidate);
    }
    return {
      analysisIdentity:
        value.schemaVersion >= IMAGE_CACHE_SCHEMA_VERSION
          ? parseAnalysisIdentity(value.analysisIdentity)
          : undefined,
      attachmentKey: item.key,
      imageCache:
        value.schemaVersion >= IMAGE_CACHE_SCHEMA_VERSION
          ? parseImageCache(value.imageCache, results)
          : {},
      libraryID: item.libraryID,
      results,
      schemaVersion: value.schemaVersion,
      translations:
        value.schemaVersion >= TRANSLATION_SCHEMA_VERSION
          ? parseTranslationCache(value.translations, results)
          : {},
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  }

  private emptyManifest(item: Zotero.Item): FigureResultManifest {
    return {
      analysisIdentity: this.analysisIdentity,
      attachmentKey: item.key,
      imageCache: {},
      libraryID: item.libraryID,
      results: [],
      schemaVersion: SCHEMA_VERSION,
      translations: {},
      updatedAt: "",
    };
  }

  private async commit(
    item: Zotero.Item,
    results: FigureResultRecord[],
    translations: FigureResultTranslationCache,
    imageCache: FigureResultImageCache = {},
    directoryReady = false,
    timings?: FigureResultStoreTimings,
  ): Promise<void> {
    const startedAt = Date.now();
    const manifest: FigureResultManifest = {
      analysisIdentity: this.analysisIdentity,
      attachmentKey: item.key,
      imageCache: pruneImageCache(imageCache, results),
      libraryID: item.libraryID,
      results,
      schemaVersion: SCHEMA_VERSION,
      translations: pruneTranslationCache(translations, results),
      updatedAt: new Date().toISOString(),
    };
    const path = this.getManifestPath(item);
    const temporaryPath = `${path}.part-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    try {
      if (!directoryReady) {
        await IOUtils.makeDirectory(this.getAttachmentDirectory(item), {
          createAncestors: true,
          ignoreExisting: true,
        });
      }
      await IOUtils.writeUTF8(temporaryPath, JSON.stringify(manifest, null, 2));
      await IOUtils.move(temporaryPath, path, { noOverwrite: false });
    } finally {
      if (await IOUtils.exists(temporaryPath)) {
        await IOUtils.remove(temporaryPath, { ignoreAbsent: true });
      }
      if (timings) timings.manifestWriteMs += Date.now() - startedAt;
    }
  }

  private async writeImage(
    item: Zotero.Item,
    result: FigureResultRecord,
    image: ArrayBuffer,
  ): Promise<void> {
    const path = this.getResultPath(item, result);
    const temporaryPath = `${path}.part-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    try {
      await IOUtils.write(temporaryPath, new Uint8Array(image));
      await IOUtils.move(temporaryPath, path, { noOverwrite: false });
    } finally {
      if (await IOUtils.exists(temporaryPath)) {
        await IOUtils.remove(temporaryPath, { ignoreAbsent: true });
      }
    }
  }

  private async removeObsoleteImages(
    item: Zotero.Item,
    previous: readonly FigureResultRecord[],
    results: readonly FigureResultRecord[],
  ): Promise<void> {
    const retained = new Set(results.map((result) => result.imageFile));
    await this.removeImages(
      item,
      previous.filter((result) => !retained.has(result.imageFile)),
    );
  }

  private async removeImages(
    item: Zotero.Item,
    results: readonly FigureResultRecord[],
  ): Promise<void> {
    for (const result of results) {
      try {
        await this.removeImage(item, result);
      } catch (error) {
        Zotero.logError(toError(error));
      }
    }
  }

  private createImageCacheEntry(
    result: FigureResultRecord,
    sourceFingerprint: string,
  ): FigureResultImageCacheEntry {
    return {
      ...this.analysisIdentity,
      fingerprint: getFigureResultImageFingerprint(result),
      sourceFingerprint,
    };
  }

  private async isReusableImage(
    item: Zotero.Item,
    imageCache: FigureResultImageCache,
    result: FigureResultRecord,
    sourceFingerprint: string,
  ): Promise<boolean> {
    const cached = imageCache[result.id];
    return (
      cached?.fingerprint === getFigureResultImageFingerprint(result) &&
      cached.sourceFingerprint === sourceFingerprint &&
      analysisIdentitiesMatch(cached, this.analysisIdentity) &&
      (await IOUtils.exists(this.getResultPath(item, result)))
    );
  }

  public async getSourceFingerprint(
    item: Zotero.Item,
    signal?: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal);
    try {
      const getFilePath = (
        item as Zotero.Item & {
          getFilePathAsync?: () => Promise<false | string>;
        }
      ).getFilePathAsync;
      const path = getFilePath ? await getFilePath.call(item) : false;
      throwIfAborted(signal);
      if (path) {
        const info = await IOUtils.stat(path);
        throwIfAborted(signal);
        if (
          typeof info.size === "number" &&
          Number.isFinite(info.size) &&
          typeof info.lastModified === "number" &&
          Number.isFinite(info.lastModified)
        ) {
          return `file:${info.size}:${info.lastModified}`;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw new OperationCancelledError();
      Zotero.logError(toError(error));
    }
    const version = (item as Zotero.Item & { version?: number }).version;
    return `item:${item.libraryID}:${item.key}:${
      Number.isFinite(version) ? version : "unknown"
    }`;
  }

  private async removeImage(
    item: Zotero.Item,
    result: FigureResultRecord,
  ): Promise<void> {
    await IOUtils.remove(this.getResultPath(item, result), {
      ignoreAbsent: true,
    });
  }

  private withImagePath(
    item: Zotero.Item,
    result: FigureResultRecord,
  ): StoredFigureResult {
    return { ...result, imagePath: this.getResultPath(item, result) };
  }

  private getManifestPath(item: Zotero.Item): string {
    return PathUtils.join(this.getAttachmentDirectory(item), "manifest.json");
  }

  private getAttachmentDirectory(item: Zotero.Item): string {
    if (!Number.isInteger(item.libraryID) || item.libraryID < 0) {
      throw new Error("Figure result item has an invalid library ID");
    }
    if (!/^[A-Za-z0-9_-]+$/.test(item.key)) {
      throw new Error("Figure result item has an invalid attachment key");
    }
    return PathUtils.join(
      Zotero.DataDirectory.dir,
      ...ROOT_DIRECTORY.split("/"),
      String(item.libraryID),
      item.key,
    );
  }

  private getImagesDirectory(item: Zotero.Item): string {
    return PathUtils.join(this.getAttachmentDirectory(item), "images");
  }

  private getResultPath(item: Zotero.Item, result: FigureResultRecord): string {
    if (
      !/^[a-z0-9-]+$/.test(result.id) ||
      result.imageFile !== `images/${result.id}.png`
    ) {
      throw new Error("Figure result has an invalid image path");
    }
    return PathUtils.join(this.getImagesDirectory(item), `${result.id}.png`);
  }

  private async acquireAttachmentLock(
    item: Zotero.Item,
    signal?: AbortSignal,
  ): Promise<() => void> {
    throwIfAborted(signal);
    const key = this.getAttachmentDirectory(item);
    const state = attachmentLocks.get(key) ?? { active: false, waiters: [] };
    attachmentLocks.set(key, state);
    return new Promise<() => void>((resolve, reject) => {
      const waiter: AttachmentLockWaiter = { reject, resolve, signal };
      waiter.abort = () => {
        const index = state.waiters.indexOf(waiter);
        if (index < 0) return;
        state.waiters.splice(index, 1);
        removeWaiterAbortListener(waiter);
        reject(new OperationCancelledError());
        cleanupAttachmentLock(key, state);
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      state.waiters.push(waiter);
      dispatchAttachmentLock(key, state);
    });
  }
}

function dispatchAttachmentLock(key: string, state: AttachmentLockState): void {
  if (state.active) return;
  while (state.waiters.length > 0) {
    const waiter = state.waiters.shift() as AttachmentLockWaiter;
    removeWaiterAbortListener(waiter);
    if (waiter.signal?.aborted) {
      waiter.reject(new OperationCancelledError());
      continue;
    }
    state.active = true;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      state.active = false;
      dispatchAttachmentLock(key, state);
    });
    return;
  }
  cleanupAttachmentLock(key, state);
}

function cleanupAttachmentLock(key: string, state: AttachmentLockState): void {
  if (
    !state.active &&
    state.waiters.length === 0 &&
    attachmentLocks.get(key) === state
  ) {
    attachmentLocks.delete(key);
  }
}

function removeWaiterAbortListener(waiter: AttachmentLockWaiter): void {
  if (waiter.abort) {
    waiter.signal?.removeEventListener("abort", waiter.abort);
  }
}

function assertPageCandidates(
  pageIndex: number,
  candidates: readonly AnnotationCandidate[],
): void {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    candidates.some((candidate) => candidate.pageIndex !== pageIndex)
  ) {
    throw new Error("Figure result candidates do not match the target page");
  }
}

function normalizeAnalysisIdentity(
  identity: FigureResultAnalysisIdentity,
): FigureResultAnalysisIdentity {
  if (!isAnalysisIdentity(identity)) {
    throw new Error("Figure result analysis identity is invalid");
  }
  return { ...identity, modelHash: identity.modelHash.toLowerCase() };
}

function parseAnalysisIdentity(
  value: unknown,
): FigureResultAnalysisIdentity | undefined {
  return isAnalysisIdentity(value)
    ? normalizeAnalysisIdentity(value)
    : undefined;
}

function isAnalysisIdentity(
  value: unknown,
): value is FigureResultAnalysisIdentity {
  if (!isObjectRecord(value)) return false;
  return (
    Number.isInteger(value.analysisVersion) &&
    (value.analysisVersion as number) > 0 &&
    typeof value.modelHash === "string" &&
    /^[a-fA-F0-9]{64}$/.test(value.modelHash) &&
    typeof value.previewVersion === "string" &&
    value.previewVersion.length > 0 &&
    value.previewVersion.length <= 100
  );
}

function analysisIdentitiesMatch(
  first: FigureResultAnalysisIdentity,
  second: FigureResultAnalysisIdentity,
): boolean {
  return (
    first.analysisVersion === second.analysisVersion &&
    first.modelHash.toLowerCase() === second.modelHash.toLowerCase() &&
    first.previewVersion === second.previewVersion
  );
}

function parseImageCache(
  value: unknown,
  results: readonly FigureResultRecord[],
): FigureResultImageCache {
  if (!isObjectRecord(value)) return {};
  const parsed: FigureResultImageCache = {};
  for (const [resultID, candidate] of Object.entries(value)) {
    if (!isObjectRecord(candidate) || !isAnalysisIdentity(candidate)) continue;
    if (typeof candidate.fingerprint !== "string") continue;
    if (typeof candidate.sourceFingerprint !== "string") continue;
    parsed[resultID] = {
      ...normalizeAnalysisIdentity(candidate),
      fingerprint: candidate.fingerprint,
      sourceFingerprint: candidate.sourceFingerprint,
    };
  }
  return pruneImageCache(parsed, results);
}

function pruneImageCache(
  cache: FigureResultImageCache,
  results: readonly FigureResultRecord[],
): FigureResultImageCache {
  const resultsByID = new Map(results.map((result) => [result.id, result]));
  const pruned: FigureResultImageCache = {};
  for (const [resultID, entry] of Object.entries(cache)) {
    const result = resultsByID.get(resultID);
    if (
      result &&
      isAnalysisIdentity(entry) &&
      typeof entry.sourceFingerprint === "string" &&
      entry.sourceFingerprint.length > 0 &&
      entry.fingerprint === getFigureResultImageFingerprint(result)
    ) {
      pruned[resultID] = {
        ...normalizeAnalysisIdentity(entry),
        fingerprint: entry.fingerprint,
        sourceFingerprint: entry.sourceFingerprint,
      };
    }
  }
  return pruned;
}

function isFigureResultRecord(value: unknown): value is FigureResultRecord {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<FigureResultRecord>;
  return (
    typeof result.comment === "string" &&
    (result.detectedComment === undefined ||
      typeof result.detectedComment === "string") &&
    (result.detectedRect === undefined || isResultRect(result.detectedRect)) &&
    typeof result.id === "string" &&
    /^[a-z0-9-]+$/.test(result.id) &&
    result.imageFile === `images/${result.id}.png` &&
    (result.kind === "figure" ||
      result.kind === "formula" ||
      result.kind === "table") &&
    typeof result.pageIndex === "number" &&
    Number.isInteger(result.pageIndex) &&
    result.pageIndex >= 0 &&
    typeof result.pageLabel === "string" &&
    Array.isArray(result.rect) &&
    result.rect.length === 4 &&
    result.rect.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    result.rect[2] > result.rect[0] &&
    result.rect[3] > result.rect[1] &&
    typeof result.tag === "string" &&
    result.kind === getFigureResultKind(result.tag) &&
    result.id ===
      getFigureResultID({
        comment: result.detectedComment ?? result.comment,
        pageIndex: result.pageIndex,
        rect: result.detectedRect ?? result.rect,
        tag: result.tag,
      })
  );
}

function preserveManualOverrides(
  detected: FigureResultRecord,
  existing: FigureResultRecord,
): FigureResultRecord {
  return {
    ...detected,
    ...(existing.detectedComment === undefined
      ? {}
      : {
          comment: existing.comment,
          detectedComment: detected.comment,
        }),
    ...(existing.detectedRect === undefined
      ? {}
      : {
          detectedRect: detected.rect,
          rect: existing.rect,
        }),
  };
}

function normalizeResultRect(value: readonly number[]): Rect {
  if (!isResultRect(value)) {
    throw new Error("Corrected figure result rectangle is invalid");
  }
  return value.map((coordinate) => Math.round(coordinate * 100) / 100) as Rect;
}

function isResultRect(value: unknown): value is Rect {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[2] > value[0] &&
    value[3] > value[1]
  );
}

function resultRectsMatch(first: Rect, second: Rect): boolean {
  return first.every(
    (coordinate, index) => Math.abs(coordinate - second[index]) < 0.005,
  );
}

async function readOptionalImage(
  path: string,
): Promise<ArrayBuffer | undefined> {
  try {
    return await IOUtils.read(path);
  } catch {
    return undefined;
  }
}

function normalizeManualComment(comment: string): string {
  if (typeof comment !== "string") {
    throw new TypeError("Figure result comment must be a string");
  }
  const normalized = comment.trim();
  if (normalized.length > 10_000) {
    throw new RangeError("Figure result comment exceeds 10,000 characters");
  }
  return normalized;
}

function parseTranslationCache(
  value: unknown,
  results: readonly FigureResultRecord[],
): FigureResultTranslationCache {
  if (!isObjectRecord(value)) return {};
  const parsed: FigureResultTranslationCache = {};
  for (const [resultID, contextsValue] of Object.entries(value)) {
    if (!isObjectRecord(contextsValue)) continue;
    const contexts: FigureResultTranslationContexts = {};
    for (const [contextKey, translationValue] of Object.entries(
      contextsValue,
    )) {
      if (
        !isTranslationContextKey(contextKey) ||
        !isFigureResultTranslation(translationValue)
      ) {
        continue;
      }
      contexts[contextKey] = translationValue;
    }
    if (Object.keys(contexts).length) parsed[resultID] = contexts;
  }
  return pruneTranslationCache(parsed, results);
}

function pruneTranslationCache(
  cache: FigureResultTranslationCache,
  results: readonly FigureResultRecord[],
): FigureResultTranslationCache {
  const resultsByID = new Map(results.map((result) => [result.id, result]));
  const pruned: FigureResultTranslationCache = {};
  for (const [resultID, contexts] of Object.entries(cache)) {
    const result = resultsByID.get(resultID);
    if (!result || !isObjectRecord(contexts)) continue;
    const retainedContexts: FigureResultTranslationContexts = {};
    for (const [contextKey, translation] of Object.entries(contexts)) {
      if (
        isTranslationContextKey(contextKey) &&
        isFigureResultTranslation(translation) &&
        translation.source === result.comment
      ) {
        retainedContexts[contextKey] = { ...translation };
      }
    }
    if (Object.keys(retainedContexts).length) {
      pruned[resultID] = retainedContexts;
    }
  }
  return pruned;
}

function getTranslationsForContext(
  manifest: FigureResultManifest,
  contextKey: string,
): Map<string, string> {
  const translations = new Map<string, string>();
  for (const result of manifest.results) {
    const translation = manifest.translations[result.id]?.[contextKey];
    if (
      translation?.source === result.comment &&
      translation.text.trim().length > 0
    ) {
      translations.set(result.id, translation.text);
    }
  }
  return translations;
}

function isFigureResultTranslation(
  value: unknown,
): value is FigureResultTranslation {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.source === "string" &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    typeof value.translatedAt === "string" &&
    value.translatedAt.length > 0
  );
}

function assertTranslationContextKey(contextKey: string): void {
  if (!isTranslationContextKey(contextKey)) {
    throw new Error("Figure translation cache has an invalid context key");
  }
}

function isTranslationContextKey(contextKey: string): boolean {
  return (
    contextKey.startsWith("zotero-pdf-translate/v1:") &&
    contextKey.length <= 160 &&
    /^[A-Za-z0-9._:/%-]+$/.test(contextKey)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CandidateImageEntry {
  candidate: AnnotationCandidate;
  fingerprint: string;
  image: ArrayBuffer;
}

function getUniqueCandidateEntries(
  candidates: readonly AnnotationCandidate[],
  images: readonly ArrayBuffer[],
): CandidateImageEntry[] {
  const entries: CandidateImageEntry[] = [];
  const fingerprints = new Set<string>();
  const fingerprintByID = new Map<string, string>();
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const fingerprint = getFigureResultFingerprint(candidate);
    if (fingerprints.has(fingerprint)) continue;
    const id = getFigureResultID(candidate);
    const collidingFingerprint = fingerprintByID.get(id);
    if (collidingFingerprint && collidingFingerprint !== fingerprint) {
      throw new Error(`Figure result ID collision: ${id}`);
    }
    fingerprints.add(fingerprint);
    fingerprintByID.set(id, fingerprint);
    entries.push({ candidate, fingerprint, image: images[index] });
  }
  return entries;
}

function assertResultIDAvailable(
  record: FigureResultRecord,
  fingerprint: string,
  existingByID: ReadonlyMap<string, FigureResultRecord>,
): void {
  const existing = existingByID.get(record.id);
  if (existing && getFigureResultFingerprint(existing) !== fingerprint) {
    throw new Error(`Figure result ID collision: ${record.id}`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationCancelledError();
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
