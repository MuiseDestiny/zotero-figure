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
const pinnedCardViewSource = readFileSync(
  "src/features/reader/pinnedFigureCardView.ts",
  "utf8",
);
const sidebarImageLoadSource = readFileSync(
  "src/features/reader/sidebarImageLoadCoordinator.ts",
  "utf8",
);
const resultEditorSource = readFileSync(
  "src/features/reader/sidebarResultEditorController.ts",
  "utf8",
);
const codeMirrorLatexEditorSource = readFileSync(
  "src/features/reader/codeMirrorLatexEditor.ts",
  "utf8",
);
const latexEditorViewSource = readFileSync(
  "src/features/latex-editor/latexEditorView.ts",
  "utf8",
);
const latexEditorMarkup = readFileSync(
  "addon/chrome/content/latex-editor/index.html",
  "utf8",
);
const latexEditorCSS = readFileSync(
  "addon/chrome/content/latex-editor/latex-editor.css",
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
  const actions = getRule(".zoterofigure-sidebar-actions");
  const filters = getRule(".zoterofigure-sidebar-filters");
  const filterSlot = getRule(".zoterofigure-sidebar-filter-slot");
  const filterButton = getRule(".zoterofigure-sidebar-filter");
  const hoveredFilter = getRule(".zoterofigure-sidebar-filter:hover");
  const filterIcon = getRule(".zoterofigure-sidebar-filter-icon");
  const selectedFilter = getRule(".zoterofigure-sidebar-filter.selected");
  const list = getRule(".zoterofigure-sidebar-list");
  const cardHeader = getRule(".zoterofigure-sidebar-card > header");
  const focusedCard = getRule(".zoterofigure-sidebar-card:focus");
  const cardPage = getRule(".zoterofigure-card-page");
  const cardImage = getExactRule(".zoterofigure-card-image");
  const latexCardImage = getExactRule(".zoterofigure-card-image.is-latex");
  const cardImageElement = getExactRule(".zoterofigure-card-image img");
  const renderedLatex = getExactRule(".zoterofigure-rendered-latex");
  const cardComment = getExactRule(".zoterofigure-card-comment");
  const cardCommentText = getExactRule(".zoterofigure-card-comment-text");
  const pinnedLatex = getRule(
    ".zoterofigure-pinned-card .zoterofigure-card-image.is-latex",
  );
  const noteIcon = getRule(".zoterofigure-native-note-icon");
  const analysisAction = getRule(".zoterofigure-analysis-action");
  const analysisIcon = getRule(".zoterofigure-analysis-plugin-icon");
  const emptyAnalysisAction = getRule(".zoterofigure-sidebar-empty-action");
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
  assert.match(actions, /background\s*:\s*var\(--material-mix-quarternary\)/);
  assert.match(filters, /display\s*:\s*flex/);
  assert.match(filters, /flex-direction\s*:\s*row/);
  assert.match(filters, /gap\s*:\s*6px/);
  assert.match(filters, /height\s*:\s*30px/);
  assert.match(filters, /justify-content\s*:\s*flex-start/);
  assert.match(filters, /margin\s*:\s*0\.5em 1em/);
  assert.match(filterSlot, /flex\s*:\s*0 1 max-content/);
  assert.match(filterSlot, /align-items\s*:\s*center/);
  assert.match(filterSlot, /max-width\s*:\s*100%/);
  assert.match(filterSlot, /position\s*:\s*relative/);
  assert.match(filterSlot, /width\s*:\s*max-content/);
  assert.doesNotMatch(filterSlot, /width\s*:\s*\d+px/);
  assert.match(filterButton, /--zoterofigure-filter-accent/);
  assert.match(
    filterButton,
    /background\s*:\s*var\(--material-mix-quarternary\)/,
  );
  assert.match(filterButton, /border\s*:\s*1px solid transparent/);
  assert.match(filterButton, /border-radius\s*:\s*20px/);
  assert.match(filterButton, /display\s*:\s*flex/);
  assert.match(filterButton, /font\s*:\s*inherit/);
  assert.match(filterButton, /font-size\s*:\s*12px/);
  assert.match(filterButton, /height\s*:\s*26px/);
  assert.match(filterButton, /padding\s*:\s*1px 5px/);
  assert.match(filterButton, /width\s*:\s*100%/);
  assert.match(filterIcon, /background\s*:\s*transparent/);
  assert.match(filterIcon, /color\s*:\s*var\(--zoterofigure-filter-accent\)/);
  assert.match(selectedFilter, /background\s*:\s*color-mix/);
  assert.match(selectedFilter, /--zoterofigure-filter-accent\) 12%/);
  assert.match(selectedFilter, /border-color\s*:\s*color-mix/);
  assert.match(hoveredFilter, /background\s*:\s*color-mix/);
  assert.match(hoveredFilter, /--material-mix-quarternary\) 92%/);
  assert.match(hoveredFilter, /--fill-primary\) 8%/);
  assert.match(cardHeader, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(focusedCard, /outline\s*:\s*2px solid var\(--accent-blue/);
  assert.match(focusedCard, /outline-offset\s*:\s*-2px/);
  assert.match(cardPage, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(cardImage, /background\s*:\s*var\(--material-background\)/);
  assert.match(cardImage, /overflow\s*:\s*hidden/);
  assert.match(cardImage, /padding\s*:\s*0/);
  assert.match(latexCardImage, /justify-content\s*:\s*flex-start/);
  assert.match(latexCardImage, /overflow\s*:\s*auto/);
  assert.match(renderedLatex, /margin-inline\s*:\s*auto/);
  assert.match(renderedLatex, /min-width\s*:\s*max-content/);
  assert.match(cardImageElement, /height\s*:\s*auto\s*!important/);
  assert.match(cardImageElement, /max-height\s*:\s*none\s*!important/);
  assert.match(cardImageElement, /max-width\s*:\s*100%\s*!important/);
  assert.match(cardImageElement, /min-width\s*:\s*0/);
  assert.match(cardImageElement, /width\s*:\s*100%\s*!important/);
  assert.match(
    pinnedLatex,
    /font-size\s*:\s*var\(--zoterofigure-pinned-latex-font-size, 1em\)/,
  );
  assert.match(cardComment, /align-items\s*:\s*center/);
  assert.match(cardComment, /max-height\s*:\s*calc\(1\.35em \+ 15px\)/);
  assert.match(cardComment, /overflow\s*:\s*hidden/);
  assert.match(cardComment, /white-space\s*:\s*nowrap/);
  assert.match(cardCommentText, /display\s*:\s*block/);
  assert.match(cardCommentText, /text-overflow\s*:\s*ellipsis/);
  assert.match(cardCommentText, /overflow-wrap\s*:\s*normal/);
  assert.match(cardCommentText, /white-space\s*:\s*nowrap/);
  assert.doesNotMatch(cardCommentText, /-webkit-line-clamp/);
  assert.doesNotMatch(css, /\.zoterofigure-card-comment\.expanded/);
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
  assert.match(emptyAnalysisAction, /display\s*:\s*inline-flex/);
  assert.match(emptyAnalysisAction, /min-height\s*:\s*30px/);
  assert.match(emptyAnalysisAction, /max-width\s*:\s*calc\(100% - 24px\)/);
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
    "  private positionFilterPopover(",
  );
  const positionPopover = getSourceSection(
    panelSource,
    "  private positionFilterPopover(",
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
    "  private createCardStart(",
  );
  const filters = getRule(".zoterofigure-sidebar-filters");
  const filterSlot = getRule(".zoterofigure-sidebar-filter-slot");
  const popover = getRule(".zoterofigure-filter-results");
  const result = getRule(".zoterofigure-filter-result");
  const hoveredResult = getRule(".zoterofigure-filter-result:focus-visible");
  const resultLabel = getRule(".zoterofigure-filter-result-label");
  const resultPage = getRule(".zoterofigure-filter-result-page");

  assert.match(createFilters, /filterAndSortFigureSidebarItems\(/);
  assert.match(createFilters, /"figure", "table", "formula"/);
  assert.doesNotMatch(createFilters, /"all"/);
  assert.match(createFilters, /if \(counts\[filter\] === 0\) continue/);
  assert.match(createFilters, /toggleFigureSidebarFilter\(/);
  assert.match(createFilters, /this\.filters\.has\(filter\)/);
  assert.match(createFilters, /setAttribute\("aria-pressed"/);
  assert.match(createFilters, /args: \{ count: counts\[filter\] \}/);
  assert.match(createFilters, /event\.detail === 0/);
  assert.match(createFilters, /data-filter="\$\{filter\}"/);
  assert.match(createFilters, /createFigureSidebarIcon\(document, filter\)/);
  assert.match(createFilters, /content\.append\(icon, count, label\)/);
  assert.match(createFilters, /slot\.append\(button\)/);
  assert.match(createFilters, /document,\s+slot,\s+button/);
  assert.match(createFilters, /addEventListener\("mouseenter"/);
  assert.match(createFilters, /addEventListener\("focus"/);
  assert.match(createFilters, /setAttribute\("aria-haspopup", "menu"\)/);
  assert.match(openPopover, /setAttribute\("role", "menu"\)/);
  assert.match(openPopover, /popover\.dataset\.filter = filter/);
  assert.match(openPopover, /setAttribute\("role", "menuitem"\)/);
  assert.match(openPopover, /item\.tabIndex = -1/);
  assert.match(openPopover, /getString\("sidebar-page"/);
  assert.match(openPopover, /item\.append\(text, page\)/);
  assert.match(openPopover, /getFigureSidebarNavigationLabel\(/);
  assert.match(openPopover, /this\.positionFilterPopover\(host, popover\)/);
  assert.match(
    positionPopover,
    /this\.scrollContainer \?\? this\.panelContent/,
  );
  assert.match(positionPopover, /popover\.style\.maxWidth/);
  assert.match(positionPopover, /boundaryBounds\.right - popoverBounds\.width/);
  assert.match(positionPopover, /Math\.min\(Math\.max\(hostBounds\.left/);
  assert.match(positionPopover, /popover\.style\.insetInlineStart/);

  const preserveFilters = selectResult.indexOf(
    "this.filters = new Set(this.filters).add(filter)",
  );
  const render = selectResult.indexOf("this.render()");
  const scroll = selectResult.indexOf("this.scheduleResultScroll(resultID)");
  assert.match(
    selectResult,
    /this\.filters\.size > 0 && !this\.filters\.has\(filter\)/,
  );
  assert.ok(preserveFilters >= 0 && preserveFilters < render);
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
  assert.match(popover, /width\s*:\s*min\(260px, calc\(100vw - 24px\)\)/);
  assert.match(popover, /max-height\s*:\s*min\(360px, 50vh\)/);
  assert.match(popover, /overflow-y\s*:\s*auto/);
  assert.match(popover, /inset-inline-start\s*:\s*0/);
  assert.match(popover, /inset-inline-end\s*:\s*auto/);
  assert.match(result, /align-items\s*:\s*baseline/);
  assert.match(
    hoveredResult,
    /background\s*:\s*var\(--material-mix-quarternary\)/,
  );
  assert.match(resultLabel, /overflow\s*:\s*hidden/);
  assert.match(resultLabel, /text-overflow\s*:\s*ellipsis/);
  assert.match(resultLabel, /white-space\s*:\s*nowrap/);
  assert.match(resultPage, /color\s*:\s*var\(--fill-secondary\)/);
  assert.match(resultPage, /white-space\s*:\s*nowrap/);
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
    "  private restorePinnedCardInteractions(",
  );
  const restoreInteractions = getSourceSection(
    panelSource,
    "  private restorePinnedCardInteractions(",
    "  private bringPinnedCardToFront(",
  );
  const preparePinnedCard = getSourceSection(
    pinnedCardViewSource,
    "export function preparePinnedFigureCardElement(",
    "export function bindPinnedFigureCard(",
  );
  const bindPinnedCard = getSourceSection(
    pinnedCardViewSource,
    "export function bindPinnedFigureCard(",
    "function getDocumentViewportSize(",
  );
  const closePinnedCard = getSourceSection(
    panelSource,
    "  private closePinnedCard(",
    "  private reconcilePinnedCards(",
  );
  const reconcilePinnedCards = getSourceSection(
    panelSource,
    "  private reconcilePinnedCards(",
    "  private requestPinnedCardRefresh(",
  );
  const requestPinnedCardRefresh = getSourceSection(
    panelSource,
    "  private requestPinnedCardRefresh(",
    "  private createPinnedCardResultSnapshot(",
  );
  const preparePinnedCardSnapshot = getSourceSection(
    panelSource,
    "  private async preparePinnedCardSnapshot(",
    "  private createPreparedPinnedCardContent(",
  );
  const applyPinnedCardSnapshot = getSourceSection(
    panelSource,
    "  private applyPinnedCardSnapshot(",
    "  private disposePinnedCards(",
  );
  const openMenu = getSourceSection(
    panelSource,
    "  private openMenu(",
    "  private closeMenu(",
  );
  const openCommentEditor = getSourceSection(
    resultEditorSource,
    "  public async editComment(",
    "  public async correctRegion(",
  );
  const panelCommentEditor = getSourceSection(
    panelSource,
    "  private async openCommentEditor(",
    "  private async openRegionEditor(",
  );
  const panelRegionEditor = getSourceSection(
    panelSource,
    "  private async openRegionEditor(",
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

  assert.match(createCard, /media\.addEventListener\("dblclick"/);
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
  assert.match(restoreInteractions, /this\.getCurrentResult\(result\.id\)/);
  assert.match(
    restoreInteractions,
    /this\.scheduleImageNavigation\(getCurrentResult\(\)\)/,
  );
  assert.match(
    preparePinnedCard,
    /sourceGeometry\.width > 0[\s\S]*sourceGeometry\.width[\s\S]*FALLBACK_WIDTH/,
  );
  assert.match(preparePinnedCard, /element\.style\.fontFamily/);
  assert.match(preparePinnedCard, /element\.style\.fontSize/);
  assert.match(preparePinnedCard, /element\.style\.lineHeight/);
  assert.doesNotMatch(preparePinnedCard, /scale\(1\)/);
  assert.match(
    bindPinnedCard,
    /x: sourceGeometry\.right \+ CARD_MARGIN \+ stagger/,
  );
  assert.match(bindPinnedCard, /y: sourceGeometry\.top \+ stagger/);
  assert.match(bindPinnedCard, /addEventListener\("click", handleClickCapture/);
  assert.match(bindPinnedCard, /addEventListener\("pointerdown"/);
  assert.match(bindPinnedCard, /setPointerCapture\(event\.pointerId\)/);
  assert.match(bindPinnedCard, /media\.addEventListener\("wheel"/);
  assert.doesNotMatch(bindPinnedCard, /element\.addEventListener\("wheel"/);
  assert.match(bindPinnedCard, /passive: false/);
  assert.match(bindPinnedCard, /zoomPinnedCardAtPoint\(/);
  assert.match(bindPinnedCard, /getPinnedCardRenderStyles\(/);
  assert.match(bindPinnedCard, /element\.offsetHeight/);
  assert.match(bindPinnedCard, /element\.offsetWidth/);
  assert.match(bindPinnedCard, /getCardSize\(\)/);
  assert.match(bindPinnedCard, /interpolatePinnedCardTransform\(/);
  assert.match(bindPinnedCard, /getPinnedCardSmoothingProgress\(/);
  assert.match(bindPinnedCard, /frameTime - previousTransformFrameTime/);
  assert.match(bindPinnedCard, /MAX_WHEEL_DELTA[\s\S]*WHEEL_SENSITIVITY/);
  assert.match(bindPinnedCard, /requestAnimationFrame\(step\)/);
  assert.match(bindPinnedCard, /cancelAnimationFrame\(transformFrameID\)/);
  assert.match(bindPinnedCard, /addEventListener\("dblclick"/);
  assert.match(
    bindPinnedCard,
    /target\?\.closest\("button, a, input, select, textarea"\)/,
  );
  assert.match(bindPinnedCard, /onClose\(\)/);
  assert.match(pinCard, /onClose: \(\) => this\.closePinnedCard\(result\.id\)/);
  assert.match(closePinnedCard, /this\.cancelImageNavigation\(\)/);
  assert.match(closePinnedCard, /entry\.element\.contains\(this\.menuAnchor\)/);
  assert.match(closePinnedCard, /this\.closeMenu\(\)/);
  assert.match(reconcilePinnedCards, /this\.requestPinnedCardRefresh/);
  assert.match(
    requestPinnedCardRefresh,
    /entry\s*\.\s*refreshSnapshot\(prepare\)/,
  );
  assert.match(
    requestPinnedCardRefresh,
    /entry\.cancelPendingSnapshotRefresh\(\)/,
  );
  assert.match(preparePinnedCardSnapshot, /await IOUtils\.read/);
  assert.match(preparePinnedCardSnapshot, /await loadMonitor\.promise/);
  assert.match(preparePinnedCardSnapshot, /blobURL\.release/);
  assert.match(applyPinnedCardSnapshot, /imageContainer\.replaceChildren/);
  assert.doesNotMatch(applyPinnedCardSnapshot, /element\.replaceWith/);
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
  assert.match(openMenu, /"sidebar-rerecognize-latex"/);
  assert.match(openMenu, /this\.rerecognizeFormulaLatex\(anchor, result\)/);
  assert.ok(
    openMenu.indexOf('"sidebar-copy-latex"') <
      openMenu.indexOf('"sidebar-rerecognize-latex"'),
  );
  assert.ok(
    openMenu.indexOf('"sidebar-rerecognize-latex"') <
      openMenu.indexOf('"sidebar-edit-latex"'),
  );
  assert.match(resultEditorSource, /tag: "textarea"/);
  assert.match(resultEditorSource, /"data-bind": "comment"/);
  assert.match(resultEditorSource, /COMMENT_EDITOR_MAX_LENGTH/);
  assert.match(resultEditorSource, /rows: 2/);
  assert.match(resultEditorSource, /resize: "none"/);
  assert.match(resultEditorSource, /openCodeMirrorLatexEditor/);
  assert.match(resultEditorSource, /latexEditor\?\.close/);
  assert.doesNotMatch(resultEditorSource, /"data-bind": "latex"/);
  assert.match(
    codeMirrorLatexEditorSource,
    /chrome:\/\/zoterofigure\/content\/latex-editor\/index\.html/,
  );
  assert.doesNotMatch(codeMirrorLatexEditorSource, /chrome:\/\/scaffold/);
  assert.match(codeMirrorLatexEditorSource, /dialogData/);
  assert.match(codeMirrorLatexEditorSource, /settle\(undefined\)/);
  assert.match(latexEditorViewSource, /StreamLanguage\.define\(stexMath\)/);
  assert.match(latexEditorViewSource, /EditorView\.lineWrapping/);
  assert.match(latexEditorViewSource, /EditorView\.updateListener/);
  assert.match(latexEditorViewSource, /throwOnError: true/);
  assert.match(latexEditorViewSource, /saveButton\.disabled/);
  assert.match(latexEditorMarkup, /id="latex-editor"/);
  assert.match(latexEditorMarkup, /id="latex-preview"/);
  assert.match(latexEditorMarkup, /id="latex-cancel"/);
  assert.match(latexEditorMarkup, /id="latex-save"/);
  assert.match(
    latexEditorCSS,
    /grid-template-rows:\s*minmax\(150px, 2fr\) minmax\(180px, 3fr\)/,
  );
  assert.match(openCommentEditor, /this\.options\.onEditComment\(/);
  assert.match(openCommentEditor, /\+\+this\.commentGeneration/);
  assert.match(openCommentEditor, /isCurrentCommentRequest/);
  assert.match(
    panelCommentEditor,
    /this\.resultEditors\.editComment\(result\)/,
  );
  assert.match(panelCommentEditor, /this\.applyUpdatedResult\(updated\)/);
  assert.match(
    panelRegionEditor,
    /this\.resultEditors\.correctRegion\(result\)/,
  );
  assert.match(panelRegionEditor, /this\.reloadResults\(\)/);
  assert.doesNotMatch(panelSource, /new ztoolkit\.Dialog/);
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
  assert.match(createComment, /document\.createElement\("div"\)/);
  assert.match(createComment, /comment\.title = text/);
  assert.doesNotMatch(createComment, /addEventListener\("click"/);
  assert.doesNotMatch(panelSource, /expandedComments/);
  assert.doesNotMatch(panelSource, /applyCommentExpansion/);
  assert.match(pinnedCard, /position\s*:\s*fixed/);
  assert.doesNotMatch(pinnedCard, /transform-origin/);
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
  const createCard = getSourceSection(
    panelSource,
    "  private createCard(",
    "  private createCardStart(",
  );
  const pinCard = getSourceSection(
    panelSource,
    "  private async pinCard(",
    "  private restorePinnedCardInteractions(",
  );

  assert.match(panelSource, /new SidebarImageLoadCoordinator\(/);
  assert.match(createCard, /this\.imageLoads\.register\(/);
  assert.doesNotMatch(panelSource, /interface SidebarImageEntry/);
  assert.doesNotMatch(panelSource, /private async loadLocalImage/);
  assert.match(sidebarImageLoadSource, /new BoundedAsyncTaskQueue\(/);
  assert.match(sidebarImageLoadSource, /SIDEBAR_IMAGE_LOAD_CONCURRENCY = 3/);
  assert.match(
    sidebarImageLoadSource,
    /this\.readBytes\(entry\.result\.imagePath\)/,
  );
  assert.match(sidebarImageLoadSource, /createDocumentBlobURL\(document/);
  assert.match(sidebarImageLoadSource, /blobURL\.release\(\)/);
  assert.doesNotMatch(sidebarImageLoadSource, /new Blob\(/);
  assert.doesNotMatch(sidebarImageLoadSource, /URL\.createObjectURL/);
  assert.match(sidebarImageLoadSource, /getBoundingClientRect\(\)/);
  assert.match(panelSource, /media\.style\.aspectRatio/);
  assert.doesNotMatch(sidebarImageLoadSource, /readAsDataURL/);
  assert.doesNotMatch(sidebarImageLoadSource, /bytesToDataURL/);
  assert.doesNotMatch(sidebarImageLoadSource, /loading\s*=\s*["']eager["']/);
  assert.match(sidebarImageLoadSource, /container\.style\.aspectRatio = ""/);
  assert.match(
    pinCard,
    /addEventListener\(\s*"load"[\s\S]*imageContainer\.style\.aspectRatio = ""/,
  );
  assert.match(pinCard, /classList\.remove\("is-loaded"\)/);
  assert.match(
    pinCard,
    /addEventListener\(\s*"error"[\s\S]*"sidebar-image-unavailable"/,
  );
  assert.match(sidebarImageLoadSource, /await loadMonitor\.promise/);
  assert.match(sidebarImageLoadSource, /classList\.add\("is-loaded"\)/);
  assert.match(
    css,
    /\.zoterofigure-card-image\.is-loaded\s*\{[^}]*min-height\s*:\s*0/,
  );
  const loadedImage = getRule(".zoterofigure-card-image img");
  assert.match(loadedImage, /border\s*:\s*0\s*!important/);
  assert.match(loadedImage, /margin\s*:\s*0\s*!important/);
  assert.match(loadedImage, /padding\s*:\s*0\s*!important/);
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

test("offers analysis only when the PDF has no local results", () => {
  const renderContent = getSourceSection(
    panelSource,
    "  private renderContent(",
    "  private createControls(",
  );
  const createEmpty = getSourceSection(
    panelSource,
    "  private createEmpty(",
    "  private createAnalysisProgress(",
  );

  assert.match(
    renderContent,
    /this\.createEmpty\(document, results\.length === 0\)/,
  );
  assert.match(createEmpty, /document\.createElement\("button"\)/);
  assert.match(createEmpty, /sidebar-start-analysis/);
  assert.match(createEmpty, /this\.options\.isAnalyzing\(\)/);
  assert.match(createEmpty, /this\.options\.onAnalyze\(\)/);
  assert.match(createEmpty, /document\.createElement\("div"\)/);
  assert.match(createEmpty, /sidebar-empty/);
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
