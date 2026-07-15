import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("addon/chrome/content/figure-sidebar.css", "utf8");
const panelSource = readFileSync(
  "src/features/reader/figureSidebarPanel.ts",
  "utf8",
);
const controllerSource = readFileSync(
  "src/features/reader/figureReaderController.ts",
  "utf8",
);

test("uses Zotero's sidebar scroller with one sticky controls header", () => {
  const wrapper = getRule("#zoterofigure-sidebar-panel");
  const panel = getRule(".zoterofigure-sidebar-panel");
  const controls = getRule(".zoterofigure-sidebar-controls");
  const filters = getRule(".zoterofigure-sidebar-filters");
  const filterButton = getRule(".zoterofigure-sidebar-filter");
  const list = getRule(".zoterofigure-sidebar-list");
  const noteIcon = getRule(".zoterofigure-native-note-icon");
  const analysisAction = getRule(".zoterofigure-analysis-action");
  const analysisIcon = getRule(".zoterofigure-analysis-plugin-icon");
  const magnifier = getRule(
    ".zoterofigure-analysis-action .zoterofigure-analysis-magnifier",
  );

  assert.match(wrapper, /display\s*:\s*block/);
  assert.doesNotMatch(wrapper, /height\s*:\s*100%/);
  assert.doesNotMatch(wrapper, /overflow\s*:\s*(?:auto|hidden|scroll)/);
  assert.doesNotMatch(panel, /overflow\s*:\s*(?:auto|hidden|scroll)/);
  assert.doesNotMatch(list, /overflow\s*:\s*(?:auto|hidden|scroll)/);
  assert.match(controls, /position\s*:\s*sticky/);
  assert.match(controls, /top\s*:\s*0/);
  assert.match(controls, /background\s*:\s*var\(--material-sidepane/);
  assert.doesNotMatch(controls, /--material-background/);
  assert.match(filters, /display\s*:\s*flex/);
  assert.match(filters, /flex-direction\s*:\s*row/);
  assert.match(filters, /height\s*:\s*25px/);
  assert.match(filters, /justify-content\s*:\s*space-around/);
  assert.match(filters, /margin\s*:\s*0\.5em 1em/);
  assert.match(filterButton, /color\s*:\s*var\(--fill-primary\)/);
  assert.match(filterButton, /font\s*:\s*inherit/);
  assert.doesNotMatch(filterButton, /font-size\s*:\s*11px/);
  assert.match(noteIcon, /height\s*:\s*16px/);
  assert.match(noteIcon, /width\s*:\s*16px/);
  assert.doesNotMatch(noteIcon, /mask\s*:/);
  assert.match(panelSource, /iconKind === "note"/);
  assert.match(panelSource, /icon\.setAttribute\("viewBox", "0 0 20 20"\)/);
  assert.match(panelSource, /path\.setAttribute\("fill", "currentColor"\)/);
  assert.doesNotMatch(
    panelSource,
    /chrome:\/\/zotero\/skin\/20\/universal\/note/,
  );
  assert.match(analysisAction, /position\s*:\s*relative/);
  assert.match(analysisIcon, /height\s*:\s*16px/);
  assert.match(analysisIcon, /width\s*:\s*16px/);
  assert.match(magnifier, /position\s*:\s*absolute/);
  assert.match(magnifier, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(magnifier, /height\s*:\s*12px/);
  assert.match(magnifier, /left\s*:\s*8px/);
  assert.match(magnifier, /top\s*:\s*7px/);
  assert.match(magnifier, /stroke-width\s*:\s*2\.5/);
  assert.match(magnifier, /width\s*:\s*12px/);
  assert.match(
    magnifier,
    /animation\s*:\s*zoterofigure-inspect 2600ms ease-in-out infinite/,
  );
  assert.doesNotMatch(
    css,
    /zoterofigure-analysis-plugin-icon\s*\{[^}]*opacity/,
  );
  assert.match(css, /@keyframes zoterofigure-inspect/);
  assert.match(css, /17%\s*\{[^}]*translate\(3px, -2px\)/);
  assert.match(css, /39%\s*\{[^}]*translate\(1px, 2px\)/);
  assert.match(css, /63%\s*\{[^}]*translate\(5px, 1px\)/);
  assert.match(css, /81%\s*\{[^}]*translate\(2px, -1px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(panelSource, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(panelSource, /createPluginIcon\(document/);
  assert.doesNotMatch(panelSource, /element === this\.panel\s*\?\s*"flex"/);
});

test("hides the result filters until local results exist", () => {
  const createControls = getSourceSection(
    panelSource,
    "  private createControls(",
    "  private createLoading(",
  );

  assert.match(
    createControls,
    /controls\.append\(this\.createActions\(document, results\)\)/,
  );
  assert.match(createControls, /if \(results\.length > 0\)/);
  assert.match(
    createControls,
    /controls\.append\(this\.createFilters\(document, results\)\)/,
  );
});

test("navigates hover result menus without rebuilding the active filter", () => {
  const createFilters = getSourceSection(
    panelSource,
    "  private createFilters(",
    "  private openFilterPopover(",
  );
  const openPopover = getSourceSection(
    panelSource,
    "  private openFilterPopover(",
    "  private handleFilterPopoverKeydown(",
  );
  const selectResult = getSourceSection(
    panelSource,
    "  private selectFilterResult(",
    "  private scheduleResultScroll(",
  );
  const scrollResult = getSourceSection(
    panelSource,
    "  private scheduleResultScroll(",
    "  private cancelResultScroll(",
  );
  const createCard = getSourceSection(
    panelSource,
    "  private createCard(",
    "  private async loadLocalImage(",
  );
  const filters = getRule(".zoterofigure-sidebar-filters");
  const popover = getRule(".zoterofigure-filter-results");
  const resultLabel = getRule(".zoterofigure-filter-result-label");

  assert.match(createFilters, /filterAndSortFigureSidebarItems\(/);
  assert.match(createFilters, /addEventListener\("mouseenter"/);
  assert.match(createFilters, /addEventListener\("focus"/);
  assert.match(createFilters, /setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(openPopover, /setAttribute\("role", "menu"\)/);
  assert.match(openPopover, /setAttribute\("role", "menuitem"\)/);
  assert.match(openPopover, /item\.title = label/);
  assert.match(openPopover, /getFigureSidebarNavigationLabel\(/);

  const filterAssignment = selectResult.indexOf("this.filter = filter");
  const render = selectResult.indexOf("if (filterChanged) this.render()");
  const scroll = selectResult.indexOf("this.scheduleResultScroll(resultID)");
  assert.ok(filterAssignment >= 0 && filterAssignment < render);
  assert.ok(render < scroll);
  assert.match(scrollResult, /this\.resultCards\.get\(resultID\)/);
  assert.match(scrollResult, /this\.scrollContainer/);
  assert.match(scrollResult, /controlsHeight/);
  assert.match(scrollResult, /viewport\.scrollTo\(/);
  assert.match(createCard, /card\.dataset\.resultId = result\.id/);
  assert.match(createCard, /this\.resultCards\.set\(result\.id, card\)/);

  assert.match(filters, /overflow\s*:\s*visible/);
  assert.match(filters, /position\s*:\s*relative/);
  assert.match(popover, /position\s*:\s*absolute/);
  assert.match(popover, /inset-inline\s*:\s*0/);
  assert.match(popover, /max-height\s*:\s*min\(320px, 45vh\)/);
  assert.match(popover, /overflow-y\s*:\s*auto/);
  assert.match(resultLabel, /overflow\s*:\s*hidden/);
  assert.match(resultLabel, /text-overflow\s*:\s*ellipsis/);
  assert.match(resultLabel, /white-space\s*:\s*nowrap/);
});

test("clears the sidebar before local files without touching annotation mirrors", () => {
  const panelClear = getSourceSection(
    panelSource,
    "  private async clearLocalResults()",
    "  private createAnalysisButton(",
  );
  const controllerClear = getSourceSection(
    controllerSource,
    "  private async clearResults(",
    "  private async removeResult(",
  );

  assert.match(panelClear, /this\.results = \[\]/);
  assert.ok(
    panelClear.indexOf("this.render()") <
      panelClear.indexOf("await this.options.onClear()"),
  );
  assert.match(panelClear, /ownerWindow\.setTimeout\(resolve, 0\)/);
  assert.match(
    controllerClear,
    /await this\.resultStore\.clear\(reader\._item\)/,
  );
  assert.doesNotMatch(controllerClear, /reloadSidebarResults/);
  assert.doesNotMatch(controllerClear, /refreshSidebarControls/);
  assert.doesNotMatch(controllerClear, /confirm\(/);
  assert.doesNotMatch(controllerClear, /createProgress/);
  assert.doesNotMatch(controllerClear, /removeGeneratedAnnotations/);
});

test("loads local previews lazily through revocable blob URLs", () => {
  assert.match(panelSource, /new BoundedAsyncTaskQueue\(/);
  assert.match(panelSource, /IMAGE_LOAD_CONCURRENCY = 3/);
  assert.match(panelSource, /IOUtils\.read\(entry\.result\.imagePath\)/);
  assert.match(panelSource, /createDocumentBlobURL\(entry\.document/);
  assert.match(panelSource, /blobURL\.release\(\)/);
  assert.doesNotMatch(panelSource, /new Blob\(/);
  assert.doesNotMatch(panelSource, /URL\.createObjectURL/);
  assert.match(panelSource, /getBoundingClientRect\(\)/);
  assert.match(panelSource, /image\.style\.aspectRatio/);
  assert.doesNotMatch(panelSource, /readAsDataURL/);
  assert.doesNotMatch(panelSource, /bytesToDataURL/);
  assert.doesNotMatch(panelSource, /loading\s*=\s*["']eager["']/);
});

test("analysis updates controls without rebuilding cards and reloads once", () => {
  const runAnalysis = getSourceSection(
    controllerSource,
    "  private async runAnalysis(",
    "  private cancelAnalysis(",
  );

  assert.equal(
    countMatches(runAnalysis, /refreshSidebarControls\(reader\)/g),
    2,
  );
  assert.equal(countMatches(runAnalysis, /reloadSidebarResults\(reader\)/g), 1);
  assert.doesNotMatch(runAnalysis, /\.refresh\(\)/);
  assert.ok(
    runAnalysis.lastIndexOf("reloadSidebarResults(reader)") >
      runAnalysis.indexOf("finally"),
  );
});

function getRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

function getSourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source section start: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function countMatches(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}
