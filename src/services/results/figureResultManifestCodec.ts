import {
  getFigureResultID,
  getFigureResultImageFingerprint,
  getFigureResultKind,
  isFigureResultTag,
  type FigureResultAnalysisIdentity,
  type FigureResultRecord,
} from "../../domain/figureResults";
import type { Rect } from "../../domain/layout";

// Owns the versioned on-disk contract; filesystem and host I/O stay in the store.
export const FIGURE_RESULT_MANIFEST_SCHEMA_VERSION = 6;

const LATEX_SCHEMA_VERSION = 6;
const IMAGE_CACHE_SCHEMA_VERSION = 3;
const TRANSLATION_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;

export interface FigureResultManifestOwner {
  attachmentKey: string;
  libraryID: number;
}

export interface FigureResultTranslation {
  source: string;
  text: string;
  translatedAt: string;
}

type FigureResultTranslationContexts = Record<string, FigureResultTranslation>;

export type FigureResultTranslationCache = Record<
  string,
  FigureResultTranslationContexts
>;

export interface FigureResultImageCacheEntry extends FigureResultAnalysisIdentity {
  fingerprint: string;
  sourceFingerprint: string;
}

export type FigureResultImageCache = Record<
  string,
  FigureResultImageCacheEntry
>;

export interface FigureResultManifest extends FigureResultManifestOwner {
  analysisIdentity?: FigureResultAnalysisIdentity;
  imageCache: FigureResultImageCache;
  results: FigureResultRecord[];
  schemaVersion: number;
  translations: FigureResultTranslationCache;
  updatedAt: string;
}

export interface CreateFigureResultManifestOptions extends FigureResultManifestOwner {
  analysisIdentity: FigureResultAnalysisIdentity;
  imageCache?: FigureResultImageCache;
  results: FigureResultRecord[];
  translations: FigureResultTranslationCache;
  updatedAt: string;
}

export class FigureResultManifestParseError extends Error {
  constructor(
    public readonly reason: string,
    public readonly sourceError?: unknown,
  ) {
    super(reason);
    this.name = "FigureResultManifestParseError";
  }
}

export function decodeFigureResultManifest(
  source: string,
  owner: FigureResultManifestOwner,
): FigureResultManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new FigureResultManifestParseError("contains invalid JSON", error);
  }
  if (!isObjectRecord(parsed)) {
    throw new FigureResultManifestParseError("has an invalid structure");
  }
  const value = parsed as Partial<FigureResultManifest>;
  if (
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
  ) {
    throw new Error(
      `Figure result manifest schema ${value.schemaVersion} is newer than supported schema ${FIGURE_RESULT_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (
    !isSupportedSchemaVersion(value.schemaVersion) ||
    value.attachmentKey !== owner.attachmentKey ||
    value.libraryID !== owner.libraryID ||
    !Array.isArray(value.results)
  ) {
    throw new FigureResultManifestParseError("has an invalid structure");
  }

  const results: FigureResultRecord[] = [];
  const resultIDs = new Set<string>();
  for (const candidate of value.results) {
    if (!isFigureResultRecord(candidate, value.schemaVersion)) {
      throw new FigureResultManifestParseError(
        "contains an invalid result record",
      );
    }
    const result = { ...candidate };
    if (value.schemaVersion < LATEX_SCHEMA_VERSION) delete result.latex;
    if (resultIDs.has(result.id)) {
      throw new FigureResultManifestParseError("contains duplicate result IDs");
    }
    resultIDs.add(result.id);
    results.push(result);
  }

  return {
    analysisIdentity:
      value.schemaVersion >= IMAGE_CACHE_SCHEMA_VERSION
        ? parseAnalysisIdentity(value.analysisIdentity)
        : undefined,
    attachmentKey: owner.attachmentKey,
    imageCache:
      value.schemaVersion >= IMAGE_CACHE_SCHEMA_VERSION
        ? parseImageCache(value.imageCache, results)
        : {},
    libraryID: owner.libraryID,
    results,
    schemaVersion: value.schemaVersion,
    translations:
      value.schemaVersion >= TRANSLATION_SCHEMA_VERSION
        ? parseTranslationCache(value.translations, results)
        : {},
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export function createEmptyFigureResultManifest(
  owner: FigureResultManifestOwner,
  analysisIdentity: FigureResultAnalysisIdentity,
): FigureResultManifest {
  return {
    analysisIdentity: normalizeFigureResultAnalysisIdentity(analysisIdentity),
    attachmentKey: owner.attachmentKey,
    imageCache: {},
    libraryID: owner.libraryID,
    results: [],
    schemaVersion: FIGURE_RESULT_MANIFEST_SCHEMA_VERSION,
    translations: {},
    updatedAt: "",
  };
}

export function createFigureResultManifest(
  options: CreateFigureResultManifestOptions,
): FigureResultManifest {
  return {
    analysisIdentity: normalizeFigureResultAnalysisIdentity(
      options.analysisIdentity,
    ),
    attachmentKey: options.attachmentKey,
    imageCache: pruneFigureResultImageCache(
      options.imageCache ?? {},
      options.results,
    ),
    libraryID: options.libraryID,
    results: options.results,
    schemaVersion: FIGURE_RESULT_MANIFEST_SCHEMA_VERSION,
    translations: pruneFigureResultTranslationCache(
      options.translations,
      options.results,
    ),
    updatedAt: options.updatedAt,
  };
}

export function serializeFigureResultManifest(
  manifest: FigureResultManifest,
): string {
  return JSON.stringify(manifest, null, 2);
}

export function normalizeFigureResultAnalysisIdentity(
  identity: FigureResultAnalysisIdentity,
): FigureResultAnalysisIdentity {
  if (!isAnalysisIdentity(identity)) {
    throw new Error("Figure result analysis identity is invalid");
  }
  return { ...identity, modelHash: identity.modelHash.toLowerCase() };
}

function figureResultAnalysisIdentitiesMatch(
  first: FigureResultAnalysisIdentity,
  second: FigureResultAnalysisIdentity,
): boolean {
  return (
    first.analysisVersion === second.analysisVersion &&
    first.modelHash.toLowerCase() === second.modelHash.toLowerCase() &&
    first.previewVersion === second.previewVersion
  );
}

export function createFigureResultImageCacheEntry(
  analysisIdentity: FigureResultAnalysisIdentity,
  result: FigureResultRecord,
  sourceFingerprint: string,
): FigureResultImageCacheEntry {
  return {
    ...normalizeFigureResultAnalysisIdentity(analysisIdentity),
    fingerprint: getFigureResultImageFingerprint(result),
    sourceFingerprint,
  };
}

export function getFigureResultImageCacheIdentity(
  entry: FigureResultImageCacheEntry,
): string {
  return JSON.stringify([
    entry.analysisVersion,
    entry.modelHash,
    entry.previewVersion,
    entry.fingerprint,
    entry.sourceFingerprint,
  ]);
}

export function isReusableFigureResultImageCacheEntry(
  entry: FigureResultImageCacheEntry | undefined,
  result: FigureResultRecord,
  sourceFingerprint: string,
  analysisIdentity: FigureResultAnalysisIdentity,
): boolean {
  return (
    entry?.fingerprint === getFigureResultImageFingerprint(result) &&
    entry.sourceFingerprint === sourceFingerprint &&
    figureResultAnalysisIdentitiesMatch(entry, analysisIdentity)
  );
}

export function pruneFigureResultImageCache(
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
        ...normalizeFigureResultAnalysisIdentity(entry),
        fingerprint: entry.fingerprint,
        sourceFingerprint: entry.sourceFingerprint,
      };
    }
  }
  return pruned;
}

export function assertFigureResultTranslationContextKey(
  contextKey: string,
): void {
  if (!isTranslationContextKey(contextKey)) {
    throw new Error("Figure translation cache has an invalid context key");
  }
}

export function getFigureResultTranslationsForContext(
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

export function pruneFigureResultTranslationCache(
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

export function isFigureResultRect(value: unknown): value is Rect {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[2] > value[0] &&
    value[3] > value[1]
  );
}

function isSupportedSchemaVersion(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= LEGACY_SCHEMA_VERSION &&
    (value as number) <= FIGURE_RESULT_MANIFEST_SCHEMA_VERSION
  );
}

function parseAnalysisIdentity(
  value: unknown,
): FigureResultAnalysisIdentity | undefined {
  return isAnalysisIdentity(value)
    ? normalizeFigureResultAnalysisIdentity(value)
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
      ...normalizeFigureResultAnalysisIdentity(candidate),
      fingerprint: candidate.fingerprint,
      sourceFingerprint: candidate.sourceFingerprint,
    };
  }
  return pruneFigureResultImageCache(parsed, results);
}

function isFigureResultRecord(
  value: unknown,
  schemaVersion: number,
): value is FigureResultRecord {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<FigureResultRecord>;
  return (
    typeof result.comment === "string" &&
    (result.detectedComment === undefined ||
      typeof result.detectedComment === "string") &&
    (result.detectedRect === undefined ||
      isFigureResultRect(result.detectedRect)) &&
    typeof result.id === "string" &&
    /^[a-z0-9-]+$/.test(result.id) &&
    result.imageFile === `images/${result.id}.png` &&
    (result.kind === "figure" ||
      result.kind === "formula" ||
      result.kind === "table") &&
    (schemaVersion < LATEX_SCHEMA_VERSION ||
      result.latex === undefined ||
      (result.kind === "formula" &&
        typeof result.latex === "string" &&
        result.latex.trim().length > 0)) &&
    typeof result.pageIndex === "number" &&
    Number.isInteger(result.pageIndex) &&
    result.pageIndex >= 0 &&
    typeof result.pageLabel === "string" &&
    isFigureResultRect(result.rect) &&
    typeof result.tag === "string" &&
    isFigureResultTag(result.tag) &&
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
  return pruneFigureResultTranslationCache(parsed, results);
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
