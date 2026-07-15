import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hooksSource = readFileSync("src/hooks.ts", "utf8");
const controllerSource = readFileSync(
  "src/features/reader/figureReaderController.ts",
  "utf8",
);

test("shares one analyzer across main windows and disposes it at shutdown", () => {
  assert.match(hooksSource, /const resultStore = new FigureResultStore\(\)/);
  assert.match(
    hooksSource,
    /const layoutAnalyzer = new LayoutAnalyzer\(resultStore\)/,
  );
  assert.match(
    hooksSource,
    /new FigureReaderController\(win, \{\s*layoutAnalyzer,\s*resultStore,/,
  );
  assert.match(hooksSource, /layoutAnalyzer\.dispose\(\)/);
  assert.match(
    hooksSource,
    /new FigureBatchController\(layoutAnalyzer, resultStore\)/,
  );
  assert.match(hooksSource, /batchController\.start\(\)/);
  assert.match(hooksSource, /batchController\.dispose\(\)/);
  assert.match(controllerSource, /if \(this\.ownsLayoutAnalyzer\)/);
  assert.match(
    hooksSource,
    /const galleryControllers = new Map<Window, FigureGalleryController>/,
  );
  assert.match(
    hooksSource,
    /galleryControllers\.set\(win, galleryController\)/,
  );
  assert.match(hooksSource, /galleryControllers\.clear\(\)/);
});
