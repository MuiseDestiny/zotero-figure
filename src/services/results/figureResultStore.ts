import {
  createFigureResultRecord,
  getFigureResultFingerprint,
  getFigureResultID,
  type DuplicateMode,
  type FigureResultAnalysisIdentity,
  type FigureResultRecord,
} from "../../domain/figureResults";
import type { AnnotationCandidate, Rect } from "../../domain/layout";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import { KeyedAsyncMutex } from "../concurrency/keyedAsyncMutex";
import { RECOMMENDED_MODEL } from "../model/modelCatalog";
import * as manifestCodec from "./figureResultManifestCodec";
import type {
  FigureResultImageCache,
  FigureResultImageCacheEntry,
  FigureResultManifest,
  FigureResultTranslationCache,
} from "./figureResultManifestCodec";
import { ImageWriteTransaction } from "./imageWriteTransaction";

const ROOT_DIRECTORY = "zotero-figure/results";
const attachmentLocks = new KeyedAsyncMutex<string>();

export const DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY: FigureResultAnalysisIdentity =
  Object.freeze({
    analysisVersion: 4,
    modelHash: RECOMMENDED_MODEL.sha256,
    previewVersion: "mupdf-region-v1",
  });

export type { FigureResultTranslation } from "./figureResultManifestCodec";

export interface FigureResultTranslationUpdate {
  id: string;
  source: string;
  text: string;
}

export interface FigureResultStoreOptions {
  analysisIdentity?: FigureResultAnalysisIdentity;
}

export interface StoredFigureResult extends FigureResultRecord {
  imagePath: string;
}

export interface FormulaLatexState {
  imageIdentity: string;
  latex: string | null;
  result: StoredFigureResult;
}

export interface FormulaRecognitionInput extends FormulaLatexState {
  image: Uint8Array;
}

export interface FigureResultRenderCandidate {
  detectedCandidate: AnnotationCandidate;
  renderRect: Rect;
}

export interface FigureResultStoreReconcile {
  created: number;
  removed: number;
  results: StoredFigureResult[];
  skipped: number;
  timings: FigureResultStoreTimings;
}

export interface FigureResultStorePrune {
  removed: number;
  removedPageIndices: number[];
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
    this.analysisIdentity = manifestCodec.normalizeFigureResultAnalysisIdentity(
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

  public async readFormulaRecognitionInput(
    item: Zotero.Item,
    resultID: string,
    signal?: AbortSignal,
  ): Promise<FormulaRecognitionInput | undefined> {
    const release = await this.acquireAttachmentLock(item, signal);
    try {
      const manifest = await this.readManifest(item);
      throwIfAborted(signal);
      const state = this.getFormulaLatexState(item, manifest, resultID);
      if (!state) return undefined;
      const image = await IOUtils.read(state.result.imagePath);
      throwIfAborted(signal);
      if (!image.byteLength) throw new Error("Formula result image is empty");
      return { ...state, image };
    } finally {
      release();
    }
  }

  public async readFormulaLatexState(
    item: Zotero.Item,
    resultID: string,
  ): Promise<FormulaLatexState | undefined> {
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      return this.getFormulaLatexState(item, manifest, resultID);
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

  public async getPageRenderCandidates(
    item: Zotero.Item,
    pageIndex: number,
    candidates: readonly AnnotationCandidate[],
    signal?: AbortSignal,
  ): Promise<FigureResultRenderCandidate[]> {
    assertPageCandidates(pageIndex, candidates);
    const release = await this.acquireAttachmentLock(item, signal);
    try {
      const manifest = await this.readManifest(item);
      throwIfAborted(signal);
      const existingByFingerprint = new Map(
        manifest.results
          .filter((result) => result.pageIndex === pageIndex)
          .map((result) => [getFigureResultFingerprint(result), result]),
      );
      return candidates.map((candidate) => {
        const existing = existingByFingerprint.get(
          getFigureResultFingerprint(candidate),
        );
        return {
          detectedCandidate: {
            ...candidate,
            rect: [...candidate.rect] as Rect,
          },
          renderRect:
            existing?.detectedRect === undefined
              ? ([...candidate.rect] as Rect)
              : ([...existing.rect] as Rect),
        };
      });
    } finally {
      release();
    }
  }

  public async getCachedTranslations(
    item: Zotero.Item,
    contextKey: string,
  ): Promise<Map<string, string>> {
    manifestCodec.assertFigureResultTranslationContextKey(contextKey);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      return manifestCodec.getFigureResultTranslationsForContext(
        manifest,
        contextKey,
      );
    } finally {
      release();
    }
  }

  public async saveTranslations(
    item: Zotero.Item,
    contextKey: string,
    updates: readonly FigureResultTranslationUpdate[],
  ): Promise<Map<string, string>> {
    manifestCodec.assertFigureResultTranslationContextKey(contextKey);
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const resultsByID = new Map(
        manifest.results.map((result) => [result.id, result]),
      );
      const translations = manifestCodec.pruneFigureResultTranslationCache(
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
      if (
        changed ||
        manifest.schemaVersion !==
          manifestCodec.FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
      ) {
        await this.commit(
          item,
          manifest.results,
          translations,
          manifest.imageCache,
        );
      }
      return manifestCodec.getFigureResultTranslationsForContext(
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
      const translations = manifestCodec.pruneFigureResultTranslationCache(
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

  public async updateFormulaLatex(
    item: Zotero.Item,
    resultID: string,
    latex: string,
    expectedImageIdentity?: string,
    expectedLatex?: string | null,
  ): Promise<StoredFigureResult | undefined> {
    const normalizedLatex = latex.trim();
    if (!normalizedLatex) {
      throw new Error("Formula LaTeX is empty");
    }
    const release = await this.acquireAttachmentLock(item);
    try {
      const manifest = await this.readManifest(item);
      const existing = manifest.results.find(({ id }) => id === resultID);
      if (!existing) return undefined;
      const imageCacheEntry = manifest.imageCache[resultID];
      if (
        expectedImageIdentity !== undefined &&
        (!imageCacheEntry ||
          manifestCodec.getFigureResultImageCacheIdentity(imageCacheEntry) !==
            expectedImageIdentity)
      ) {
        throw new Error("Formula image changed during LaTeX recognition");
      }
      if (
        expectedLatex !== undefined &&
        (existing.latex ?? null) !== expectedLatex
      ) {
        throw new Error("Formula LaTeX changed during recognition");
      }
      if (existing.kind !== "formula") {
        throw new Error("LaTeX can only be saved for formula results");
      }
      if (existing.latex === normalizedLatex) {
        return this.withImagePath(item, existing);
      }
      const updated: FigureResultRecord = {
        ...existing,
        latex: normalizedLatex,
      };
      const results = manifest.results.map((result) =>
        result.id === resultID ? updated : result,
      );
      await this.commit(
        item,
        results,
        manifest.translations,
        manifest.imageCache,
      );
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
    signal?: AbortSignal,
  ): Promise<StoredFigureResult | undefined> {
    const normalizedRect = normalizeResultRect(rect);
    if (!isNonEmptyArrayBufferLike(image)) {
      throw new Error("Corrected figure result image is empty");
    }
    const sourceFingerprint = await this.getSourceFingerprint(item, signal);
    const release = await this.acquireAttachmentLock(item, signal);
    try {
      const manifest = await this.readManifest(item);
      throwIfAborted(signal);
      const existing = manifest.results.find(({ id }) => id === resultID);
      if (!existing) return undefined;
      const detectedRect = existing.detectedRect ?? existing.rect;
      const base = { ...existing, rect: normalizedRect };
      delete base.detectedRect;
      delete base.latex;
      const updated: FigureResultRecord = resultRectsMatch(
        normalizedRect,
        detectedRect,
      )
        ? base
        : { ...base, detectedRect: [...detectedRect] as Rect };
      const imageTransaction = this.createImageWriteTransaction(item);
      try {
        await imageTransaction.captureBeforeOverwrite(existing);
        await IOUtils.makeDirectory(this.getImagesDirectory(item), {
          createAncestors: true,
          ignoreExisting: true,
        });
        await this.writeImage(item, updated, image);
        const results = manifest.results.map((result) =>
          result.id === resultID ? updated : result,
        );
        const imageCache = {
          ...manifest.imageCache,
          [resultID]: this.createImageCacheEntry(updated, sourceFingerprint),
        };
        throwIfAborted(signal);
        await this.commit(
          item,
          results,
          manifest.translations,
          imageCache,
          true,
        );
        imageTransaction.commit();
        return this.withImagePath(item, updated);
      } catch (error) {
        await rollbackImageWrites(imageTransaction);
        throw error;
      }
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
    return this.reconcilePageWithRenderPlan(
      item,
      pageIndex,
      candidates,
      images,
      mode,
      signal,
      sourceFingerprint,
      candidates.map(({ rect }) => rect),
    );
  }

  public async reconcilePlannedPage(
    item: Zotero.Item,
    pageIndex: number,
    renderCandidates: readonly FigureResultRenderCandidate[],
    images: readonly ArrayBuffer[],
    mode: DuplicateMode,
    signal?: AbortSignal,
    sourceFingerprint?: string,
  ): Promise<FigureResultStoreReconcile> {
    return this.reconcilePageWithRenderPlan(
      item,
      pageIndex,
      renderCandidates.map(({ detectedCandidate }) => detectedCandidate),
      images,
      mode,
      signal,
      sourceFingerprint,
      renderCandidates.map(({ renderRect }) => renderRect),
    );
  }

  private async reconcilePageWithRenderPlan(
    item: Zotero.Item,
    pageIndex: number,
    candidates: readonly AnnotationCandidate[],
    images: readonly ArrayBuffer[],
    mode: DuplicateMode,
    signal?: AbortSignal,
    sourceFingerprint?: string,
    renderRects?: readonly Rect[],
  ): Promise<FigureResultStoreReconcile> {
    if (candidates.length !== images.length) {
      throw new Error("Figure result images do not match detected candidates");
    }
    if (
      renderRects !== undefined &&
      (renderRects.length !== candidates.length ||
        renderRects.some((rect) => !manifestCodec.isFigureResultRect(rect)))
    ) {
      throw new Error("Figure result render plan is invalid");
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
        renderRects,
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
    renderRects?: readonly Rect[],
  ): Promise<Omit<FigureResultStoreReconcile, "timings">> {
    const entries = getUniqueCandidateEntries(candidates, images, renderRects);
    const duplicateCandidates = candidates.length - entries.length;
    const manifest = await this.readManifest(item);
    const imageCache = manifestCodec.pruneFigureResultImageCache(
      manifest.imageCache,
      manifest.results,
    );
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
    const imageTransaction = this.createImageWriteTransaction(item);
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
      previous?: FigureResultRecord,
    ) => {
      if (previous) {
        await imageTransaction.captureBeforeOverwrite(previous);
      } else {
        imageTransaction.trackCreated(result);
      }
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
        const updatedByID = new Map<string, FigureResultRecord>();
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
              )) &&
              renderedImageMatchesResult(entry, existing)
            ) {
              const updated = clearFormulaLatex(existing);
              updatedByID.set(existing.id, updated);
              await writeCurrentImage(updated, entry.image, existing);
            }
            continue;
          }
          const record = this.createRecord(entry.candidate);
          assertResultIDAvailable(record, entry.fingerprint, existingByID);
          if (!renderedImageMatchesResult(entry, record)) {
            throw new Error("Figure result render plan became stale");
          }
          await writeCurrentImage(record, entry.image);
          createdRecords.push(record);
          existingByID.set(record.id, record);
        }
        throwIfAborted(signal);
        const results = [
          ...manifest.results.map(
            (result) => updatedByID.get(result.id) ?? result,
          ),
          ...createdRecords,
        ];
        if (
          createdRecords.length > 0 ||
          imageCacheChanged ||
          manifest.schemaVersion !==
            manifestCodec.FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
        ) {
          await this.commit(
            item,
            results,
            manifestCodec.pruneFigureResultTranslationCache(
              manifest.translations,
              results,
            ),
            manifestCodec.pruneFigureResultImageCache(imageCache, results),
            directoryReady,
            timings,
          );
        }
        committed = true;
        imageTransaction.commit();
        return {
          created: createdRecords.length,
          removed: 0,
          results: results.map((result) => this.withImagePath(item, result)),
          skipped,
        };
      } catch (error) {
        if (!committed) await rollbackImageWrites(imageTransaction);
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
      let committed = false;
      try {
        const updatedByID = new Map<string, FigureResultRecord>();
        let recordsChanged = false;
        for (const entry of entries) {
          throwIfAborted(signal);
          const existing = existingByFingerprint.get(entry.fingerprint);
          if (!existing) {
            throw new Error(
              "Matching figure result disappeared during reconciliation",
            );
          }
          const imageReusable = await this.isReusableImage(
            item,
            imageCache,
            existing,
            sourceFingerprint,
          );
          const imageWillChange =
            !imageReusable && renderedImageMatchesResult(entry, existing);
          const record = preserveManualOverrides(
            this.createRecord(entry.candidate),
            existing,
            !imageWillChange,
          );
          updatedByID.set(existing.id, record);
          recordsChanged ||= !figureResultRecordsMatch(record, existing);
          if (!imageReusable && renderedImageMatchesResult(entry, record)) {
            await writeCurrentImage(record, entry.image, existing);
          }
        }
        throwIfAborted(signal);
        const results = manifest.results.map(
          (result) => updatedByID.get(result.id) ?? result,
        );
        if (
          imageCacheChanged ||
          recordsChanged ||
          manifest.schemaVersion !==
            manifestCodec.FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
        ) {
          await this.commit(
            item,
            results,
            manifestCodec.pruneFigureResultTranslationCache(
              manifest.translations,
              results,
            ),
            manifestCodec.pruneFigureResultImageCache(imageCache, results),
            directoryReady,
            timings,
          );
        }
        committed = true;
        imageTransaction.commit();
        skipped = candidates.length;
        return {
          created: 0,
          removed: 0,
          results: results.map((result) => this.withImagePath(item, result)),
          skipped,
        };
      } catch (error) {
        if (!committed) await rollbackImageWrites(imageTransaction);
        throw error;
      }
    }

    let committed = false;
    try {
      for (const entry of entries) {
        throwIfAborted(signal);
        const matchingExisting = existingByFingerprint.get(entry.fingerprint);
        const detectedRecord = this.createRecord(entry.candidate);
        const imageReusable = matchingExisting
          ? await this.isReusableImage(
              item,
              imageCache,
              matchingExisting,
              sourceFingerprint,
            )
          : false;
        const imageNeedsWrite = !matchingExisting || !imageReusable;
        const preservedRecord = matchingExisting
          ? preserveManualOverrides(detectedRecord, matchingExisting)
          : detectedRecord;
        const imageWillChange =
          imageNeedsWrite && renderedImageMatchesResult(entry, preservedRecord);
        const record = imageWillChange
          ? clearFormulaLatex(preservedRecord)
          : preservedRecord;
        assertResultIDAvailable(record, entry.fingerprint, existingByID);
        if (imageNeedsWrite) {
          if (renderedImageMatchesResult(entry, record)) {
            await writeCurrentImage(record, entry.image, matchingExisting);
          } else if (!matchingExisting) {
            throw new Error("Figure result render plan became stale");
          }
        }
        createdRecords.push(record);
        existingByID.set(record.id, record);
      }
      throwIfAborted(signal);
      const results = [...otherResults, ...createdRecords];
      await this.commit(
        item,
        results,
        manifestCodec.pruneFigureResultTranslationCache(
          manifest.translations,
          results,
        ),
        manifestCodec.pruneFigureResultImageCache(imageCache, results),
        directoryReady,
        timings,
      );
      committed = true;
      imageTransaction.commit();
      await this.removeObsoleteImages(item, existingPage, results);
      return {
        created: createdRecords.length,
        removed: existingPage.length,
        results: results.map((result) => this.withImagePath(item, result)),
        skipped: duplicateCandidates,
      };
    } catch (error) {
      if (!committed) await rollbackImageWrites(imageTransaction);
      throw error;
    }
  }

  public async pruneAfterAnalysis(
    item: Zotero.Item,
    totalPages: number,
    skippedPageIndices: readonly number[],
    signal?: AbortSignal,
  ): Promise<FigureResultStorePrune> {
    if (!Number.isInteger(totalPages) || totalPages < 0) {
      throw new Error("Figure result analysis has an invalid page count");
    }
    const skippedPages = new Set(skippedPageIndices);
    if (
      [...skippedPages].some(
        (pageIndex) =>
          !Number.isInteger(pageIndex) ||
          pageIndex < 0 ||
          pageIndex >= totalPages,
      )
    ) {
      throw new Error("Figure result analysis has invalid skipped pages");
    }

    const timings: FigureResultStoreTimings = {
      imageWriteMs: 0,
      lockWaitMs: 0,
      manifestWriteMs: 0,
    };
    const lockStartedAt = Date.now();
    const release = await this.acquireAttachmentLock(item, signal);
    timings.lockWaitMs = Date.now() - lockStartedAt;
    try {
      const manifest = await this.readManifest(item);
      throwIfAborted(signal);
      const removed = manifest.results.filter(
        ({ pageIndex }) =>
          pageIndex >= totalPages || skippedPages.has(pageIndex),
      );
      const results = manifest.results.filter(
        ({ pageIndex }) =>
          pageIndex < totalPages && !skippedPages.has(pageIndex),
      );
      if (
        removed.length > 0 ||
        manifest.schemaVersion !==
          manifestCodec.FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
      ) {
        await this.commit(
          item,
          results,
          manifestCodec.pruneFigureResultTranslationCache(
            manifest.translations,
            results,
          ),
          manifestCodec.pruneFigureResultImageCache(
            manifest.imageCache,
            results,
          ),
          false,
          timings,
        );
        const removalStartedAt = Date.now();
        await this.removeImages(item, removed);
        timings.imageWriteMs += Date.now() - removalStartedAt;
      }
      return {
        removed: removed.length,
        removedPageIndices: [
          ...new Set(removed.map(({ pageIndex }) => pageIndex)),
        ].sort((first, second) => first - second),
        timings,
      };
    } finally {
      release();
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
        manifestCodec.pruneFigureResultTranslationCache(
          manifest.translations,
          results,
        ),
        manifestCodec.pruneFigureResultImageCache(manifest.imageCache, results),
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
    let source: string;
    try {
      source = await IOUtils.readUTF8(path);
    } catch (error) {
      throw manifestReadError(item, "could not be read", error);
    }
    try {
      return manifestCodec.decodeFigureResultManifest(source, {
        attachmentKey: item.key,
        libraryID: item.libraryID,
      });
    } catch (error) {
      if (error instanceof manifestCodec.FigureResultManifestParseError) {
        throw manifestReadError(item, error.reason, error.sourceError);
      }
      throw error;
    }
  }

  private emptyManifest(item: Zotero.Item): FigureResultManifest {
    return manifestCodec.createEmptyFigureResultManifest(
      {
        attachmentKey: item.key,
        libraryID: item.libraryID,
      },
      this.analysisIdentity,
    );
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
    const manifest = manifestCodec.createFigureResultManifest({
      analysisIdentity: this.analysisIdentity,
      attachmentKey: item.key,
      imageCache,
      libraryID: item.libraryID,
      results,
      translations,
      updatedAt: new Date().toISOString(),
    });
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
      await IOUtils.writeUTF8(
        temporaryPath,
        manifestCodec.serializeFigureResultManifest(manifest),
      );
      await IOUtils.move(temporaryPath, path, { noOverwrite: false });
    } finally {
      await removeTemporaryFile(temporaryPath);
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
      await removeTemporaryFile(temporaryPath);
    }
  }

  private createImageWriteTransaction(
    item: Zotero.Item,
  ): ImageWriteTransaction<FigureResultRecord> {
    return new ImageWriteTransaction<FigureResultRecord>({
      getKey: ({ id }) => id,
      read: (result) => this.readImageIfPresent(item, result),
      remove: (result) => this.removeImage(item, result),
      write: (result, image) => this.writeImage(item, result, image),
    });
  }

  private async readImageIfPresent(
    item: Zotero.Item,
    result: FigureResultRecord,
  ): Promise<ArrayBuffer | undefined> {
    const path = this.getResultPath(item, result);
    if (!(await IOUtils.exists(path))) return undefined;
    const bytes = await IOUtils.read(path);
    return bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
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
    return manifestCodec.createFigureResultImageCacheEntry(
      this.analysisIdentity,
      result,
      sourceFingerprint,
    );
  }

  private async isReusableImage(
    item: Zotero.Item,
    imageCache: FigureResultImageCache,
    result: FigureResultRecord,
    sourceFingerprint: string,
  ): Promise<boolean> {
    const cached = imageCache[result.id];
    return (
      manifestCodec.isReusableFigureResultImageCacheEntry(
        cached,
        result,
        sourceFingerprint,
        this.analysisIdentity,
      ) && (await IOUtils.exists(this.getResultPath(item, result)))
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

  private getFormulaLatexState(
    item: Zotero.Item,
    manifest: FigureResultManifest,
    resultID: string,
  ): FormulaLatexState | undefined {
    const result = manifest.results.find(({ id }) => id === resultID);
    if (!result) return undefined;
    if (result.kind !== "formula") {
      throw new Error("LaTeX editing requires a formula result");
    }
    const imageCacheEntry = manifest.imageCache[resultID];
    if (!imageCacheEntry) {
      throw new Error("Formula image identity is unavailable");
    }
    return {
      imageIdentity:
        manifestCodec.getFigureResultImageCacheIdentity(imageCacheEntry),
      latex: result.latex ?? null,
      result: this.withImagePath(item, result),
    };
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
    return attachmentLocks.acquire(this.getAttachmentDirectory(item), signal);
  }
}

function isNonEmptyArrayBufferLike(value: unknown): value is ArrayBuffer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { byteLength?: unknown }).byteLength === "number" &&
    (value as { byteLength: number }).byteLength > 0
  );
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

function preserveManualOverrides(
  detected: FigureResultRecord,
  existing: FigureResultRecord,
  preserveLatex = true,
): FigureResultRecord {
  return {
    ...detected,
    ...(preserveLatex && existing.latex !== undefined
      ? { latex: existing.latex }
      : {}),
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

function clearFormulaLatex(result: FigureResultRecord): FigureResultRecord {
  if (result.latex === undefined) return result;
  const updated = { ...result };
  delete updated.latex;
  return updated;
}

function figureResultRecordsMatch(
  first: FigureResultRecord,
  second: FigureResultRecord,
): boolean {
  return (
    first.comment === second.comment &&
    first.detectedComment === second.detectedComment &&
    optionalRectsExactlyMatch(first.detectedRect, second.detectedRect) &&
    first.id === second.id &&
    first.imageFile === second.imageFile &&
    first.kind === second.kind &&
    first.latex === second.latex &&
    first.pageIndex === second.pageIndex &&
    first.pageLabel === second.pageLabel &&
    rectsExactlyMatch(first.rect, second.rect) &&
    first.tag === second.tag
  );
}

function optionalRectsExactlyMatch(first?: Rect, second?: Rect): boolean {
  if (first === undefined || second === undefined) return first === second;
  return rectsExactlyMatch(first, second);
}

function rectsExactlyMatch(first: Rect, second: Rect): boolean {
  return first.every((coordinate, index) => coordinate === second[index]);
}

function normalizeResultRect(value: readonly number[]): Rect {
  if (!manifestCodec.isFigureResultRect(value)) {
    throw new Error("Corrected figure result rectangle is invalid");
  }
  return value.map((coordinate) => Math.round(coordinate * 100) / 100) as Rect;
}

function resultRectsMatch(first: Rect, second: Rect): boolean {
  return first.every(
    (coordinate, index) => Math.abs(coordinate - second[index]) < 0.005,
  );
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

interface CandidateImageEntry {
  candidate: AnnotationCandidate;
  fingerprint: string;
  image: ArrayBuffer;
  renderRect?: Rect;
}

function getUniqueCandidateEntries(
  candidates: readonly AnnotationCandidate[],
  images: readonly ArrayBuffer[],
  renderRects?: readonly Rect[],
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
    entries.push({
      candidate,
      fingerprint,
      image: images[index],
      renderRect:
        renderRects === undefined
          ? undefined
          : ([...renderRects[index]] as Rect),
    });
  }
  return entries;
}

function renderedImageMatchesResult(
  entry: CandidateImageEntry,
  result: FigureResultRecord,
): boolean {
  return (
    entry.renderRect === undefined ||
    resultRectsMatch(entry.renderRect, result.rect)
  );
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

async function rollbackImageWrites(
  transaction: ImageWriteTransaction<FigureResultRecord>,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch (error) {
    Zotero.logError(toError(error));
  }
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    if (await IOUtils.exists(path)) {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  } catch (error) {
    Zotero.logError(toError(error));
  }
}

function manifestReadError(
  item: Zotero.Item,
  reason: string,
  cause?: unknown,
): Error {
  const detail = cause === undefined ? "" : `: ${toError(cause).message}`;
  return new Error(
    `Figure result manifest for ${item.libraryID}/${item.key} ${reason}${detail}`,
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
