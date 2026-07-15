import * as assert from "node:assert/strict";
import test from "node:test";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  type FigureSidebarFilter,
} from "../src/domain/figureSidebar";

interface Entry {
  id: string;
  kind: "figure" | "table";
  pageIndex: number;
  tag: string;
}

const metadata = (entry: Entry) => entry;

test("counts all, figure, and table entries independently of filtering", () => {
  const entries: Entry[] = [
    { id: "figure-1", kind: "figure", pageIndex: 0, tag: "Figure 1" },
    { id: "table-1", kind: "table", pageIndex: 1, tag: "Table 1" },
    { id: "figure-2", kind: "figure", pageIndex: 2, tag: "Figure 2" },
  ];

  assert.deepEqual(countFigureSidebarItems(entries, metadata), {
    all: 3,
    figure: 2,
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
});

test("sorts by page, then tag, with stable ties", () => {
  const entries: Entry[] = [
    { id: "second", kind: "figure", pageIndex: 1, tag: "Figure 2" },
    { id: "first", kind: "figure", pageIndex: 0, tag: "Figure 2" },
    { id: "table", kind: "table", pageIndex: 0, tag: "Table 1" },
    { id: "same-page", kind: "figure", pageIndex: 0, tag: "Figure 2" },
  ];

  const sorted = filterAndSortFigureSidebarItems(entries, "all", metadata);

  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["first", "same-page", "table", "second"],
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
});
