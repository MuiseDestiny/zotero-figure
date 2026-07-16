import * as assert from "node:assert/strict";
import test from "node:test";
import {
  createFigureResultRecord,
  getFigureResultID,
  type FigureResultAnalysisIdentity,
  type FigureResultRecord,
} from "../src/domain/figureResults";
import type { AnnotationCandidate, Rect } from "../src/domain/layout";
import {
  assertFigureResultTranslationContextKey,
  createFigureResultImageCacheEntry,
  createFigureResultManifest,
  decodeFigureResultManifest,
  FIGURE_RESULT_MANIFEST_SCHEMA_VERSION,
  FigureResultManifestParseError,
  getFigureResultTranslationsForContext,
  isReusableFigureResultImageCacheEntry,
  pruneFigureResultImageCache,
  pruneFigureResultTranslationCache,
  serializeFigureResultManifest,
  type FigureResultManifest,
  type FigureResultTranslationCache,
} from "../src/services/results/figureResultManifestCodec";

const owner = { attachmentKey: "ATTACHMENT", libraryID: 4 };
const identity: FigureResultAnalysisIdentity = {
  analysisVersion: 4,
  modelHash: "A".repeat(64),
  previewVersion: "mupdf-region-v1",
};
const contextKey = "zotero-pdf-translate/v1:zh-Hans";

test("builds, prunes, serializes, and decodes a current manifest", () => {
  const detected = makeResult();
  const result: FigureResultRecord = {
    ...detected,
    comment: "Curated figure caption",
    detectedComment: detected.comment,
    detectedRect: [...detected.rect] as Rect,
    rect: [2, 3, 9, 11],
  };
  const cacheEntry = createFigureResultImageCacheEntry(
    identity,
    result,
    "item:4:ATTACHMENT:1",
  );
  const manifest = createFigureResultManifest({
    ...owner,
    analysisIdentity: identity,
    imageCache: {
      [result.id]: cacheEntry,
      orphan: cacheEntry,
    },
    results: [result],
    translations: {
      [result.id]: {
        [contextKey]: {
          source: result.comment,
          text: "图 1",
          translatedAt: "2026-07-16T00:00:00.000Z",
        },
        "zotero-pdf-translate/v1:it": {
          source: "stale source",
          text: "Figura 1",
          translatedAt: "2026-07-16T00:00:00.000Z",
        },
      },
      orphan: {
        [contextKey]: {
          source: "orphan",
          text: "orphan",
          translatedAt: "2026-07-16T00:00:00.000Z",
        },
      },
    },
    updatedAt: "2026-07-16T01:02:03.000Z",
  });

  assert.equal(manifest.schemaVersion, FIGURE_RESULT_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.analysisIdentity?.modelHash, "a".repeat(64));
  assert.deepEqual(Object.keys(manifest.imageCache), [result.id]);
  assert.deepEqual(Object.keys(manifest.translations), [result.id]);
  assert.deepEqual(Object.keys(manifest.translations[result.id]), [contextKey]);

  const source = serializeFigureResultManifest(manifest);
  assert.equal(source, JSON.stringify(manifest, null, 2));
  assert.deepEqual(decodeFigureResultManifest(source, owner), manifest);
});

test("decodes legacy schema gates without inventing cache metadata", () => {
  const result = makeResult();
  const cacheEntry = createFigureResultImageCacheEntry(
    identity,
    result,
    "item:4:ATTACHMENT:1",
  );
  const translations = {
    [result.id]: {
      [contextKey]: {
        source: result.comment,
        text: "图 1",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
    },
  };

  for (const schemaVersion of [1, 2, 3, 4, 5]) {
    const decoded = decodeFigureResultManifest(
      JSON.stringify({
        ...owner,
        analysisIdentity: identity,
        imageCache: { [result.id]: cacheEntry },
        results: [result],
        schemaVersion,
        translations,
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
      owner,
    );

    assert.equal(decoded.schemaVersion, schemaVersion);
    assert.equal(
      decoded.analysisIdentity?.modelHash,
      schemaVersion >= 3 ? "a".repeat(64) : undefined,
    );
    assert.deepEqual(
      Object.keys(decoded.imageCache),
      schemaVersion >= 3 ? [result.id] : [],
    );
    assert.deepEqual(
      Object.keys(decoded.translations),
      schemaVersion >= 2 ? [result.id] : [],
    );
  }
});

test("drops malformed optional metadata without discarding valid results", () => {
  const result = makeResult();
  const cacheEntry = createFigureResultImageCacheEntry(
    identity,
    result,
    "item:4:ATTACHMENT:1",
  );
  const decoded = decodeFigureResultManifest(
    JSON.stringify({
      ...owner,
      analysisIdentity: { ...identity, modelHash: "not-a-hash" },
      imageCache: {
        [result.id]: { ...cacheEntry, sourceFingerprint: "" },
      },
      results: [result],
      schemaVersion: FIGURE_RESULT_MANIFEST_SCHEMA_VERSION,
      translations: {
        [result.id]: {
          [contextKey]: {
            source: result.comment,
            text: "   ",
            translatedAt: "2026-07-16T00:00:00.000Z",
          },
        },
      },
      updatedAt: 123,
    }),
    owner,
  );

  assert.deepEqual(decoded.results, [result]);
  assert.equal(decoded.analysisIdentity, undefined);
  assert.deepEqual(decoded.imageCache, {});
  assert.deepEqual(decoded.translations, {});
  assert.equal(decoded.updatedAt, "");
});

test("rejects invalid schema structures and future manifests", () => {
  assert.throws(
    () => decodeFigureResultManifest("{broken", owner),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "contains invalid JSON" &&
      error.sourceError instanceof SyntaxError,
  );

  const result = makeResult();
  const base: FigureResultManifest = {
    ...owner,
    analysisIdentity: identity,
    imageCache: {},
    results: [result],
    schemaVersion: 5,
    translations: {},
    updatedAt: "",
  };
  for (const schemaVersion of [undefined, null, 0, -1, 1.5, "5"]) {
    assert.throws(
      () =>
        decodeFigureResultManifest(
          JSON.stringify({ ...base, schemaVersion }),
          owner,
        ),
      (error: unknown) =>
        error instanceof FigureResultManifestParseError &&
        error.reason === "has an invalid structure",
    );
  }
  for (const invalidRoot of [null, [], "manifest"]) {
    assert.throws(
      () => decodeFigureResultManifest(JSON.stringify(invalidRoot), owner),
      (error: unknown) =>
        error instanceof FigureResultManifestParseError &&
        error.reason === "has an invalid structure",
    );
  }
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, attachmentKey: "OTHER" }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "has an invalid structure",
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, libraryID: owner.libraryID + 1 }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "has an invalid structure",
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, results: {} }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "has an invalid structure",
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, results: [result, result] }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "contains duplicate result IDs",
  );
  const invalidTagCandidate: AnnotationCandidate = {
    comment: "Unmanaged image",
    pageIndex: 0,
    rect: [1, 2, 10, 12],
    tag: "Important",
  };
  const invalidTagResult = createFigureResultRecord(
    invalidTagCandidate,
    `images/${getFigureResultID(invalidTagCandidate)}.png`,
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, results: [invalidTagResult] }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "contains an invalid result record",
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({
          ...base,
          results: [{ ...result, imageFile: "images/wrong.png" }],
        }),
        owner,
      ),
    (error: unknown) =>
      error instanceof FigureResultManifestParseError &&
      error.reason === "contains an invalid result record",
  );
  assert.throws(
    () =>
      decodeFigureResultManifest(
        JSON.stringify({ ...base, schemaVersion: 6 }),
        owner,
      ),
    /schema 6 is newer than supported schema 5/,
  );
});

test("matches every image cache identity component independently of I/O", () => {
  const result = makeResult();
  const entry = createFigureResultImageCacheEntry(
    identity,
    result,
    "item:4:ATTACHMENT:1",
  );
  assert.equal(
    isReusableFigureResultImageCacheEntry(
      entry,
      result,
      "item:4:ATTACHMENT:1",
      { ...identity, modelHash: identity.modelHash.toLowerCase() },
    ),
    true,
  );
  assert.equal(
    isReusableFigureResultImageCacheEntry(
      entry,
      result,
      "item:4:ATTACHMENT:2",
      identity,
    ),
    false,
  );
  for (const mismatchedIdentity of [
    { ...identity, analysisVersion: identity.analysisVersion + 1 },
    { ...identity, modelHash: "b".repeat(64) },
    { ...identity, previewVersion: "mupdf-region-v2" },
  ]) {
    assert.equal(
      isReusableFigureResultImageCacheEntry(
        entry,
        result,
        "item:4:ATTACHMENT:1",
        mismatchedIdentity,
      ),
      false,
    );
  }
  assert.equal(
    isReusableFigureResultImageCacheEntry(
      undefined,
      result,
      "item:4:ATTACHMENT:1",
      identity,
    ),
    false,
  );
  assert.deepEqual(
    pruneFigureResultImageCache(
      { [result.id]: { ...entry, fingerprint: "stale" } },
      [result],
    ),
    {},
  );
});

test("validates translation contexts and prunes stale cache entries", () => {
  const result = makeResult();
  assert.doesNotThrow(() =>
    assertFigureResultTranslationContextKey(contextKey),
  );
  assert.throws(
    () => assertFigureResultTranslationContextKey("invalid"),
    /invalid context key/,
  );
  const translations: FigureResultTranslationCache = {
    [result.id]: {
      [contextKey]: {
        source: result.comment,
        text: "图 1",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
      "zotero-pdf-translate/v1:it": {
        source: "stale caption",
        text: "Figura 1",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
      invalid: {
        source: result.comment,
        text: "invalid context",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
      "zotero-pdf-translate/v1:blank": {
        source: result.comment,
        text: "   ",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
    },
    orphan: {
      [contextKey]: {
        source: "orphan",
        text: "orphan",
        translatedAt: "2026-07-16T00:00:00.000Z",
      },
    },
  };
  assert.deepEqual(pruneFigureResultTranslationCache(translations, [result]), {
    [result.id]: { [contextKey]: translations[result.id][contextKey] },
  });
  const manifest = createFigureResultManifest({
    ...owner,
    analysisIdentity: identity,
    results: [result],
    translations,
    updatedAt: "",
  });
  assert.deepEqual(
    [...getFigureResultTranslationsForContext(manifest, contextKey)],
    [[result.id, "图 1"]],
  );
});

function makeResult() {
  const candidate: AnnotationCandidate = {
    comment: "Figure 1. Caption",
    pageIndex: 0,
    rect: [1, 2, 10, 12],
    tag: "Figure 1",
  };
  return createFigureResultRecord(
    candidate,
    `images/${getFigureResultID(candidate)}.png`,
  );
}
