import * as assert from "node:assert/strict";
import test from "node:test";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  shouldShowFigureSidebarEmptyState,
  type FigureSidebarFilter,
} from "../src/domain/figureSidebar";

interface Entry {
  comment?: string;
  id: string;
  kind: "figure" | "formula" | "table";
  pageIndex: number;
  rect?: readonly [number, number, number, number];
  tag: string;
}

const metadata = (entry: Entry) => entry;

test("counts all result kinds independently of filtering", () => {
  const entries: Entry[] = [
    { id: "figure-1", kind: "figure", pageIndex: 0, tag: "Figure 1" },
    { id: "table-1", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "figure-2", kind: "figure", pageIndex: 2, tag: "Figure 2" },
    { id: "formula-1", kind: "formula", pageIndex: 3, tag: "Formula 1" },
  ];

  assert.deepEqual(countFigureSidebarItems(entries, metadata), {
    all: 4,
    figure: 2,
    formula: 1,
    table: 1,
  });
});

test("filters sidebar entries by kind and preserves the source array", () => {
  const entries: Entry[] = [
    { id: "table", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "figure", kind: "figure", pageIndex: 0, tag: "Figure 1" },
  ];

  const filtered = filterAndSortFigureSidebarItems(
    entries,
    "figure" satisfies FigureSidebarFilter,
    metadata,
  );

  assert.deepEqual(
    filtered.map(({ id }) => id),
    ["figure"],
  );
  assert.deepEqual(
    entries.map(({ id }) => id),
    ["table", "figure"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, "all", metadata).map(
      ({ id }) => id,
    ),
    ["figure", "table"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, "table", metadata).map(
      ({ id }) => id,
    ),
    ["table"],
  );
  assert.deepEqual(
    filterAndSortFigureSidebarItems(entries, "formula", metadata).map(
      ({ id }) => id,
    ),
    [],
  );
});

test("restores the empty state after analysis for an empty active filter", () => {
  assert.equal(shouldShowFigureSidebarEmptyState(0, true), false);
  assert.equal(shouldShowFigureSidebarEmptyState(0, false), true);
  assert.equal(shouldShowFigureSidebarEmptyState(1, false), false);
});

test("sorts by page and visual position before using the tag", () => {
  const entries: Entry[] = [
    { id: "second", kind: "figure", pageIndex: 1, tag: "Figure 2" },
    {
      id: "lower",
      kind: "figure",
      pageIndex: 0,
      rect: [40, 100, 240, 220],
      tag: "Figure 1-6",
    },
    {
      id: "upper-right",
      kind: "table",
      pageIndex: 0,
      rect: [280, 400, 500, 520],
      tag: "Table 8",
    },
    {
      id: "upper-left",
      kind: "figure",
      pageIndex: 0,
      rect: [30, 400, 250, 520],
      tag: "Figure 1-5",
    },
  ];

  const sorted = filterAndSortFigureSidebarItems(entries, "all", metadata);

  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["upper-left", "upper-right", "lower", "second"],
  );
});

test("builds concise navigation labels without duplicating figure tags", () => {
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "  Figure 12.\n A long caption  ",
      tag: "Figure 12",
    }),
    "Figure 12. A long caption",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "Central wavelengths of the sensor",
      tag: "Table 5",
    }),
    "Table 5 - Central wavelengths of the sensor",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({
      comment: "Figure 10. Boundary check",
      tag: "Figure 1",
    }),
    "Figure 1 - Figure 10. Boundary check",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({ comment: "(1)", tag: "Formula 1" }),
    "(1)",
  );
  assert.equal(
    getFigureSidebarNavigationLabel({ comment: "", tag: "Formula" }),
    "Formula",
  );
});
