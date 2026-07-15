import * as assert from "node:assert/strict";
import test from "node:test";
import { getFigureSidebarIconParts } from "../src/features/reader/figureSidebarIcons";

test("uses the requested sigma path for formula results", () => {
  assert.deepEqual(getFigureSidebarIconParts("formula"), [
    [
      "path",
      {
        d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
      },
    ],
  ]);
});

test("defines drawable parts for every sidebar icon", () => {
  for (const kind of [
    "annotation",
    "figure",
    "formula",
    "languages",
    "menu",
    "refresh",
    "search",
    "table",
    "trash",
  ] as const) {
    assert.ok(getFigureSidebarIconParts(kind).length > 0, kind);
  }
});
