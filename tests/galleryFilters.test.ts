import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryEntry } from "../src/domain/figureGallery";
import {
  buildGalleryFacetState,
  buildGalleryFilterOptions,
  filterGalleryEntries,
  formatGalleryOptionLabel,
  matchesGalleryKeyword,
} from "../src/features/gallery/galleryFilters";

const entries: FigureGalleryEntry[] = [
  galleryEntry({
    collectionIDs: [10, 10, 11],
    collectionNames: ["Alpha", "Ignored duplicate", "Beta"],
    comment: "Figure 1. Results",
    documentItemID: 1,
    documentTitle: "Zebra study",
    id: "figure",
    kind: "figure",
    tag: "Figure 1",
    year: "2024",
  }),
  galleryEntry({
    collectionIDs: [10],
    collectionNames: ["Alpha"],
    documentItemID: 1,
    documentTitle: "Zebra study",
    id: "table",
    kind: "table",
    tag: "Table 2",
    year: "2023",
  }),
  galleryEntry({
    collectionIDs: [11],
    collectionNames: ["Beta"],
    documentItemID: 2,
    documentTitle: "Alpha methods",
    id: "formula",
    kind: "formula",
    tag: "Formula 3",
    year: "2024",
  }),
];

test("builds stable counted options without double-counting one entry", () => {
  const options = buildGalleryFilterOptions(entries, {
    figure: "Figure",
    formula: "Formula",
    table: "Table",
  });

  assert.deepEqual(options.documents, [
    ["2", "Alpha methods", 1],
    ["1", "Zebra study", 2],
  ]);
  assert.deepEqual(options.collections, [
    ["10", "Alpha", 2],
    ["11", "Beta", 2],
  ]);
  assert.deepEqual(options.years, [
    ["2024", "2024", 2],
    ["2023", "2023", 1],
  ]);
  assert.deepEqual(options.kinds, [
    ["figure", "Figure", 1],
    ["formula", "Formula", 1],
    ["table", "Table", 1],
  ]);
  assert.equal(formatGalleryOptionLabel("All figures", 3), "All figures (3)");
});

test("combines gallery filters and matches keywords case-insensitively", () => {
  const sourceSnapshot = structuredClone(entries);
  const filtered = filterGalleryEntries(entries, {
    collectionID: "11",
    documentID: "1",
    keyword: " RESULTS ",
    kind: "figure",
    year: "2024",
  });

  assert.deepEqual(
    filtered.map(({ id }) => id),
    ["figure"],
  );
  assert.equal(matchesGalleryKeyword(entries[1], "TABLE 2"), true);
  assert.equal(matchesGalleryKeyword(entries[2], "alpha METHODS"), true);
  assert.equal(matchesGalleryKeyword(entries[2], "missing"), false);
  assert.deepEqual(entries, sourceSnapshot);
});

test("recomputes each facet from the other active filters", () => {
  const labels = {
    figure: "Figure",
    formula: "Formula",
    table: "Table",
  };
  const state = buildGalleryFacetState(
    entries,
    {
      collectionID: "11",
      documentID: "",
      keyword: "",
      kind: "",
      year: "",
    },
    labels,
  );

  assert.equal(state.filters.collectionID, "11");
  assert.deepEqual(state.documents, [
    ["2", "Alpha methods", 1],
    ["1", "Zebra study", 1],
  ]);
  assert.deepEqual(state.years, [["2024", "2024", 2]]);
  assert.deepEqual(state.kinds, [
    ["figure", "Figure", 1],
    ["formula", "Formula", 1],
  ]);
  assert.deepEqual(state.totals, {
    collections: 3,
    documents: 2,
    kinds: 2,
    years: 2,
  });

  const incompatible = buildGalleryFacetState(
    entries,
    { ...state.filters, year: "2023" },
    labels,
  );
  assert.equal(incompatible.filters.collectionID, "");
  assert.equal(incompatible.filters.year, "");
  assert.equal(filterGalleryEntries(entries, incompatible.filters).length, 3);
});

function galleryEntry(
  overrides: Partial<FigureGalleryEntry> &
    Pick<
      FigureGalleryEntry,
      "documentItemID" | "documentTitle" | "id" | "kind"
    >,
): FigureGalleryEntry {
  return {
    attachmentID: 100,
    collectionIDs: [],
    collectionNames: [],
    comment: "",
    libraryID: 1,
    pageIndex: 0,
    pageLabel: "1",
    rect: [1, 2, 3, 4],
    tag: "",
    year: "",
    ...overrides,
  };
}
