import * as assert from "node:assert/strict";
import test from "node:test";
import type { AnnotationCandidate } from "../src/domain/layout";
import {
  isGeneratedFigureAnnotation,
  reconcileGeneratedAnnotations,
  updateGeneratedAnnotationCommentForCandidate,
  updateGeneratedAnnotationPositionForCandidate,
} from "../src/platform/zotero/annotations";
import type { PdfReader } from "../src/platform/zotero/reader";

test("identifies generated annotations by both author and tag", () => {
  assert.equal(
    isGeneratedFigureAnnotation(annotation("zoterofigure", "Figure 2")),
    true,
  );
  assert.equal(
    isGeneratedFigureAnnotation(annotation("Researcher", "Figure 2")),
    false,
  );
  assert.equal(
    isGeneratedFigureAnnotation(annotation("zoterofigure", "Important")),
    false,
  );
  assert.equal(
    isGeneratedFigureAnnotation(annotation("zoterofigure", "Formula 7")),
    true,
  );
});

function annotation(author: string, tag: string): Zotero.Item {
  return {
    annotationAuthorName: author,
    annotationType: "image",
    getTags: () => [{ tag }],
  } as unknown as Zotero.Item;
}

test("replace-page is idempotent when generated annotations are unchanged", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Caption");
  const existing = makeExistingAnnotation(candidate);
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      makeReader([existing.item]),
      0,
      [candidate],
      "replace-page",
    );

    assert.deepEqual(result, { created: 0, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 0);
    assert.equal(existing.erased, false);
  } finally {
    harness.restore();
  }
});

test("annotation reconciliation accepts a PDF attachment without a Reader", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Caption");
  const existing = makeExistingAnnotation(candidate);
  const attachment = {
    getAnnotations: () => [existing.item],
  } as unknown as Zotero.Item;
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      attachment,
      0,
      [candidate],
      "replace-page",
    );

    assert.deepEqual(result, { created: 0, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 0);
  } finally {
    harness.restore();
  }
});

test("updates an existing generated annotation after a manual caption edit", async () => {
  const candidate = makeCandidate("Figure 1", "Figure 1. Corrected caption");
  let saves = 0;
  const annotation = {
    annotationAuthorName: "zoterofigure",
    annotationComment: "Figure 1. Detected caption",
    annotationPosition: JSON.stringify({
      pageIndex: candidate.pageIndex,
      rects: [candidate.rect],
    }),
    annotationType: "image",
    getTags: () => [{ tag: candidate.tag }],
    saveTx: async () => {
      saves++;
    },
  } as unknown as Zotero.Item;
  const attachment = {
    getAnnotations: () => [annotation],
  } as unknown as Zotero.Item;

  assert.equal(
    await updateGeneratedAnnotationCommentForCandidate(attachment, candidate),
    true,
  );
  assert.equal(annotation.annotationComment, candidate.comment);
  assert.equal(saves, 1);
});

test("updates an existing generated annotation after a region correction", async () => {
  const previous = makeCandidate("Formula 3", "(3)");
  const updated = {
    ...previous,
    rect: [2, 3, 12, 14] as [number, number, number, number],
  };
  let saves = 0;
  const existing = {
    annotationAuthorName: "zoterofigure",
    annotationComment: previous.comment,
    annotationPosition: JSON.stringify({
      pageIndex: previous.pageIndex,
      rects: [previous.rect],
    }),
    annotationType: "image",
    getTags: () => [{ tag: previous.tag }],
    saveTx: async () => {
      saves++;
    },
  } as unknown as Zotero.Item;
  const attachment = {
    getAnnotations: () => [existing],
  } as unknown as Zotero.Item;

  assert.equal(
    await updateGeneratedAnnotationPositionForCandidate(
      attachment,
      previous,
      updated,
    ),
    true,
  );
  assert.deepEqual(JSON.parse(existing.annotationPosition), {
    pageIndex: 0,
    rects: [[2, 3, 12, 14]],
  });
  assert.equal(saves, 1);
});

test("skip-existing creates only missing generated annotations", async () => {
  const existingCandidate = makeCandidate("Figure 1", "Old caption");
  const missingCandidate = makeCandidate("Table 2", "Table 2. Results", 20);
  const existing = makeExistingAnnotation(existingCandidate);
  const harness = installZoteroHarness();
  try {
    const result = await reconcileGeneratedAnnotations(
      makeReader([existing.item]),
      0,
      [existingCandidate, missingCandidate],
      "skip-existing",
    );

    assert.deepEqual(result, { created: 1, removed: 0, skipped: 1 });
    assert.equal(harness.created.length, 1);
    assert.equal(existing.erased, false);
  } finally {
    harness.restore();
  }
});

test("cancellation rolls back annotations created by the current page", async () => {
  const controller = new AbortController();
  const harness = installZoteroHarness(() => controller.abort());
  try {
    await assert.rejects(
      reconcileGeneratedAnnotations(
        makeReader([]),
        0,
        [
          makeCandidate("Figure 1", "Figure 1. Caption"),
          makeCandidate("Table 2", "Table 2. Results", 20),
        ],
        "skip-existing",
        controller.signal,
      ),
      { name: "OperationCancelledError" },
    );

    assert.equal(harness.created.length, 1);
    assert.equal(harness.created[0].erased, true);
  } finally {
    harness.restore();
  }
});

function makeCandidate(
  tag: string,
  comment: string,
  offset = 0,
): AnnotationCandidate {
  return {
    comment,
    pageIndex: 0,
    rect: [1 + offset, 2, 10 + offset, 12],
    tag,
  };
}

function makeExistingAnnotation(candidate: AnnotationCandidate): {
  erased: boolean;
  item: Zotero.Item;
} {
  const state = {
    erased: false,
    item: undefined as unknown as Zotero.Item,
  };
  state.item = {
    annotationAuthorName: "zoterofigure",
    annotationComment: candidate.comment,
    annotationPosition: JSON.stringify({
      pageIndex: candidate.pageIndex,
      rects: [candidate.rect],
    }),
    annotationType: "image",
    eraseTx: async () => {
      state.erased = true;
    },
    getTags: () => [{ tag: candidate.tag }],
  } as unknown as Zotero.Item;
  return state;
}

function makeReader(annotations: Zotero.Item[]): PdfReader {
  return {
    _item: {
      getAnnotations: () => annotations,
    },
  } as unknown as PdfReader;
}

function installZoteroHarness(onSave?: () => void): {
  created: Array<{ erased: boolean; item: Zotero.Item }>;
  restore: () => void;
} {
  const previous = globalThis.Zotero;
  const created: Array<{ erased: boolean; item: Zotero.Item }> = [];
  let nextKey = 1;
  globalThis.Zotero = {
    Annotations: {
      saveFromJSON: async () => {
        const state = {
          erased: false,
          item: undefined as unknown as Zotero.Item,
        };
        state.item = {
          eraseTx: async () => {
            state.erased = true;
          },
          saveTx: async () => undefined,
          setTags: () => undefined,
        } as unknown as Zotero.Item;
        created.push(state);
        onSave?.();
        return state.item;
      },
    },
    Utilities: {
      generateObjectKey: () => `KEY${nextKey++}`,
    },
  } as unknown as typeof Zotero;
  return {
    created,
    restore: () => {
      globalThis.Zotero = previous;
    },
  };
}
