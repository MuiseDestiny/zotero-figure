import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("addon/chrome/content/figure-sidebar.css", "utf8");
const panelSource = readFileSync(
  "src/features/reader/figureSidebarPanel.ts",
  "utf8",
);
const iconSource = readFileSync(
  "src/features/reader/figureSidebarIcons.ts",
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
  const filterSlot = getRule(".zoterofigure-sidebar-filter-slot");
  const filterButton = getRule(".zoterofigure-sidebar-filter");
  const list = getRule(".zoterofigure-sidebar-list");
  const cardHeader = getRule(".zoterofigure-sidebar-card > header");
  const cardPage = getRule(".zoterofigure-card-page");
  const cardImage = getExactRule(".zoterofigure-card-image");
  const cardImageElement = getExactRule(".zoterofigure-card-image img");
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
  assert.match(filterSlot, /flex\s*:\s*1 1 0/);
  assert.match(filterSlot, /position\s*:\s*relative/);
  assert.match(filterButton, /color\s*:\s*var\(--fill-primary\)/);
  assert.match(filterButton, /font\s*:\s*inherit/);
  assert.doesNotMatch(filterButton, /font-size\s*:\s*11px/);
  assert.match(filterButton, /width\s*:\s*100%/);
  assert.match(cardHeader, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(cardPage, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(cardImage, /background\s*:\s*var\(--material-background\)/);
  assert.match(cardImage, /overflow\s*:\s*hidden/);
  assert.match(cardImage, /padding\s*:\s*0/);
  assert.match(cardImageElement, /height\s*:\s*auto\s*!important/);
  assert.match(cardImageElement, /max-height\s*:\s*none\s*!important/);
  assert.match(cardImageElement, /max-width\s*:\s*100%\s*!important/);
  assert.match(cardImageElement, /min-width\s*:\s*0/);
  assert.match(cardImageElement, /width\s*:\s*100%\s*!important/);
  assert.match(noteIcon, /height\s*:\s*16px/);
  assert.match(noteIcon, /width\s*:\s*16px/);
  assert.doesNotMatch(noteIcon, /mask\s*:/);
  assert.match(panelSource, /iconKind === "note"/);
  assert.match(iconSource, /icon\.setAttribute\("viewBox", "0 0 20 20"\)/);
  assert.match(iconSource, /path\.setAttribute\("fill", "currentColor"\)/);
  assert.doesNotMatch(
    iconSource,
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

test("renders reader analysis progress inside the sidebar", () => {
  const runAnalysis = getSourceSection(
    controllerSource,
    "  private async runAnalysis(",
    "  private cancelAnalysis(",
  );
  const progress = getRule(".zoterofigure-analysis-progress");
  const progressTrack = getRule(".zoterofigure-analysis-progress-track");
  const progressDetail = getRule(".zoterofigure-analysis-progress-detail");

  assert.doesNotMatch(runAnalysis, /this\.createProgress\(/);
  assert.match(runAnalysis, /panel\?\.updateAnalysisProgress\(/);
  assert.match(runAnalysis, /latestProgress = progress/);
  assert.match(panelSource, /role", "progressbar"/);
  assert.match(panelSource, /"aria-valuenow"/);
  assert.match(panelSource, /sidebar-analysis-progress-title/);
  assert.match(progress, /padding\s*:\s*24px 18px 18px/);
  assert.match(progressTrack, /height\s*:\s*5px/);
  assert.match(progressDetail, /color\s*:\s*var\(--fill-secondary\)/);
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
  const filterSlot = getRule(".zoterofigure-sidebar-filter-slot");
  const popover = getRule(".zoterofigure-filter-results");
  const resultLabel = getRule(".zoterofigure-filter-result-label");

  assert.match(createFilters, /filterAndSortFigureSidebarItems\(/);
  assert.match(createFilters, /"all", "figure", "table", "formula"/);
  assert.match(createFilters, /slot\.append\(button\)/);
  assert.match(createFilters, /document,\s+slot,\s+button/);
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
  assert.match(filterSlot, /position\s*:\s*relative/);
  assert.match(popover, /position\s*:\s*absolute/);
  assert.match(popover, /inset-inline\s*:\s*0/);
  assert.match(popover, /max-height\s*:\s*min\(320px, 45vh\)/);
  assert.match(popover, /overflow-y\s*:\s*auto/);
  assert.match(resultLabel, /overflow\s*:\s*hidden/);
  assert.match(resultLabel, /text-overflow\s*:\s*ellipsis/);
  assert.match(resultLabel, /white-space\s*:\s*nowrap/);
});

test("pins a complete card with an independent image URL", () => {
  const createCard = getSourceSection(
    panelSource,
    "  private createCard(",
    "  private scheduleImageNavigation(",
  );
  const pinCard = getSourceSection(
    panelSource,
    "  private async pinCard(",
    "  private preparePinnedCardElement(",
  );
  const restoreInteractions = getSourceSection(
    panelSource,
    "  private restorePinnedCardInteractions(",
    "  private bindPinnedCard(",
  );
  const preparePinnedCard = getSourceSection(
    panelSource,
    "  private preparePinnedCardElement(",
    "  private restorePinnedCardInteractions(",
  );
  const bindPinnedCard = getSourceSection(
    panelSource,
    "  private bindPinnedCard(",
    "  private bringPinnedCardToFront(",
  );
  const closePinnedCard = getSourceSection(
    panelSource,
    "  private closePinnedCard(",
    "  private disposePinnedCards(",
  );
  const openMenu = getSourceSection(
    panelSource,
    "  private openMenu(",
    "  private closeMenu(",
  );
  const openCommentEditor = getSourceSection(
    panelSource,
    "  private async openCommentEditor(",
    "  private applyUpdatedResult(",
  );
  const applyUpdatedResult = getSourceSection(
    panelSource,
    "  private applyUpdatedResult(",
    "  private getCurrentResult(",
  );
  const createComment = getSourceSection(
    panelSource,
    "  private createComment(",
    "  private createMenuButton(",
  );
  const pinnedCard = getRule(
    ".zoterofigure-sidebar-card.zoterofigure-pinned-card",
  );

  assert.match(createCard, /image\.addEventListener\("dblclick"/);
  assert.match(createCard, /this\.cancelImageNavigation\(\)/);
  assert.match(pinCard, /IOUtils\.read\(result\.imagePath\)/);
  assert.match(pinCard, /this\.pinGeneration !== generation/);
  assert.match(
    pinCard,
    /this\.pendingPinnedCards\.set\(result\.id, generation\)/,
  );
  assert.match(
    pinCard,
    /this\.pendingPinnedCards\.get\(result\.id\) === generation/,
  );
  assert.match(pinCard, /createDocumentBlobURL\(document/);
  assert.match(pinCard, /sourceCard\.cloneNode\(true\)/);
  assert.match(pinCard, /if \(!sourceCard\.isConnected\) return/);
  assert.match(pinCard, /sourceBounds\.right/);
  assert.match(pinCard, /sourceBounds\.top/);
  assert.match(pinCard, /sourceBounds\.width/);
  assert.match(
    pinCard,
    /document\.defaultView\?\.getComputedStyle\(sourceCard\)/,
  );
  assert.ok(
    pinCard.indexOf("await IOUtils.read") <
      pinCard.indexOf("const sourceBounds"),
  );
  assert.match(
    pinCard,
    /this\.restorePinnedCardInteractions\(element, result\)/,
  );
  assert.match(pinCard, /document\.documentElement\.append\(element\)/);
  assert.match(pinCard, /releaseOrphanedImageURL/);
  assert.match(
    restoreInteractions,
    /this\.createMenuButton\(document, result\)/,
  );
  assert.match(restoreInteractions, /this\.createComment\(document, result\)/);
  assert.match(restoreInteractions, /this\.scheduleImageNavigation\(result\)/);
  assert.match(
    preparePinnedCard,
    /sourceGeometry\.width > 0[\s\S]*sourceGeometry\.width[\s\S]*PINNED_CARD_FALLBACK_WIDTH/,
  );
  assert.match(preparePinnedCard, /element\.style\.fontFamily/);
  assert.match(preparePinnedCard, /element\.style\.fontSize/);
  assert.match(preparePinnedCard, /element\.style\.lineHeight/);
  assert.match(
    bindPinnedCard,
    /x: sourceGeometry\.right \+ PINNED_CARD_MARGIN \+ stagger/,
  );
  assert.match(bindPinnedCard, /y: sourceGeometry\.top \+ stagger/);
  assert.match(bindPinnedCard, /addEventListener\("click", handleClickCapture/);
  assert.match(bindPinnedCard, /addEventListener\("pointerdown"/);
  assert.match(bindPinnedCard, /setPointerCapture\(event\.pointerId\)/);
  assert.match(bindPinnedCard, /addEventListener\("wheel"/);
  assert.match(bindPinnedCard, /passive: false/);
  assert.match(bindPinnedCard, /zoomPinnedCardAtPoint\(/);
  assert.match(bindPinnedCard, /element\.offsetHeight/);
  assert.match(bindPinnedCard, /element\.offsetWidth/);
  assert.match(bindPinnedCard, /getCardSize\(\)/);
  assert.match(bindPinnedCard, /interpolatePinnedCardTransform\(/);
  assert.match(bindPinnedCard, /getPinnedCardSmoothingProgress\(/);
  assert.match(bindPinnedCard, /frameTime - previousTransformFrameTime/);
  assert.match(
    bindPinnedCard,
    /PINNED_CARD_MAX_WHEEL_DELTA[\s\S]*PINNED_CARD_WHEEL_SENSITIVITY/,
  );
  assert.match(bindPinnedCard, /requestAnimationFrame\(step\)/);
  assert.match(bindPinnedCard, /cancelAnimationFrame\(transformFrameID\)/);
  assert.match(bindPinnedCard, /addEventListener\("dblclick"/);
  assert.match(
    bindPinnedCard,
    /target\?\.closest\("button, a, input, select, textarea"\)/,
  );
  assert.match(bindPinnedCard, /this\.closePinnedCard\(resultID\)/);
  assert.match(closePinnedCard, /this\.cancelImageNavigation\(\)/);
  assert.match(closePinnedCard, /entry\.element\.contains\(this\.menuAnchor\)/);
  assert.match(closePinnedCard, /this\.closeMenu\(\)/);
  assert.match(
    openMenu,
    /\.zoterofigure-sidebar-card:not\(\.zoterofigure-pinned-card\)/,
  );
  assert.match(openMenu, /"sidebar-pin-image"/);
  assert.match(openMenu, /this\.cancelImageNavigation\(\)/);
  assert.match(openMenu, /return this\.pinCard\(result, sourceCard\)/);
  assert.ok(
    openMenu.indexOf('"sidebar-save-image"') <
      openMenu.indexOf('"sidebar-pin-image"'),
  );
  assert.ok(
    openMenu.indexOf('"sidebar-pin-image"') <
      openMenu.indexOf('"sidebar-go-to-page"'),
  );
  assert.match(openMenu, /"sidebar-edit-comment"/);
  assert.match(openMenu, /this\.openCommentEditor\(result\)/);
  assert.match(openMenu, /"sidebar-correct-region"/);
  assert.match(openMenu, /this\.openRegionEditor\(result\)/);
  assert.match(openCommentEditor, /tag: "textarea"/);
  assert.match(openCommentEditor, /"data-bind": "comment"/);
  assert.match(openCommentEditor, /COMMENT_EDITOR_MAX_LENGTH/);
  assert.match(openCommentEditor, /rows: 2/);
  assert.match(openCommentEditor, /resize: "none"/);
  assert.doesNotMatch(openCommentEditor, /resize: "vertical"/);
  assert.match(openCommentEditor, /this\.options\.onEditComment\(/);
  assert.match(applyUpdatedResult, /this\.translatedComments\.delete/);
  assert.match(applyUpdatedResult, /this\.translationRequestID\+\+/);
  assert.match(applyUpdatedResult, /this\.translationPending = false/);
  assert.match(applyUpdatedResult, /this\.resultCards\.get\(updated\.id\)/);
  assert.match(applyUpdatedResult, /this\.pinnedCards\.get\(updated\.id\)/);
  assert.match(
    applyUpdatedResult,
    /this\.createMenuButton\(document, updated\)/,
  );
  assert.match(applyUpdatedResult, /this\.createComment\(document, updated\)/);
  assert.match(applyUpdatedResult, /this\.refreshControls\(\)/);
  assert.match(createComment, /!comment\.classList\.contains\("expanded"\)/);
  assert.match(createComment, /this\.resultCards\.get\(resultID\)/);
  assert.match(createComment, /this\.pinnedCards\.get\(resultID\)/);
  assert.match(pinnedCard, /position\s*:\s*fixed/);
  assert.match(pinnedCard, /transform-origin\s*:\s*top left/);
  assert.doesNotMatch(
    css,
    /zoterofigure-pinned-card[^}]*pointer-events\s*:\s*none/,
  );
  assert.doesNotMatch(css, /zoterofigure-pinned-card:focus-visible/);
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
  const loadLocalImage = getSourceSection(
    panelSource,
    "  private async loadLocalImage(",
    "  private isCurrentImageEntry(",
  );
  const pinCard = getSourceSection(
    panelSource,
    "  private async pinCard(",
    "  private preparePinnedCardElement(",
  );

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
  assert.match(
    loadLocalImage,
    /addEventListener\(\s*"load"[\s\S]*container\.style\.aspectRatio = ""/,
  );
  assert.match(
    pinCard,
    /addEventListener\(\s*"load"[\s\S]*imageContainer\.style\.aspectRatio = ""/,
  );
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

function getExactRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing exact CSS rule for ${selector}`);
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
