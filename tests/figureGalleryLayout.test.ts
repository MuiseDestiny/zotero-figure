import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync("addon/chrome/content/gallery/index.html", "utf8");
const script = readFileSync(
  "src/features/gallery/figureGalleryView.ts",
  "utf8",
);
const filters = readFileSync("src/features/gallery/galleryFilters.ts", "utf8");
const imageCoordinator = readFileSync(
  "src/features/gallery/galleryImageLoadCoordinator.ts",
  "utf8",
);
const imageLoadMonitor = readFileSync(
  "src/features/reader/imageLoadMonitor.ts",
  "utf8",
);
const loadCoordinator = readFileSync(
  "src/features/gallery/galleryLibraryLoadCoordinator.ts",
  "utf8",
);
const css = readFileSync("addon/chrome/content/gallery/gallery.css", "utf8");
const tabAdapter = readFileSync("src/platform/zotero/mainTab.ts", "utf8");
const hooks = readFileSync("src/hooks.ts", "utf8");

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return script.slice(start, end);
}

test("opens the gallery through an isolated Zotero custom tab", () => {
  assert.match(tabAdapter, /tabs\.add\(\{/);
  assert.match(tabAdapter, /type: this\.options\.type/);
  assert.match(tabAdapter, /"browser"/);
  assert.match(tabAdapter, /type: "content"/);
  assert.match(tabAdapter, /remote: "false"/);
  assert.doesNotMatch(tabAdapter, /"iframe"/);
  assert.match(tabAdapter, /tabs\.select\(tab\.id\)/);
  assert.match(tabAdapter, /this\.window[\s\S]*Zotero_Tabs/);
  assert.match(tabAdapter, /data: \{ icon: this\.options\.iconName \}/);
  assert.match(tabAdapter, /data-item-type=/);
  assert.match(tabAdapter, /this\.options\.iconURL/);
  assert.match(hooks, /new Map<Window, FigureGalleryController>/);
  assert.match(hooks, /addon\.api\.gallery = \{/);
  assert.match(hooks, /galleryController\.start\(\)/);
  assert.match(hooks, /delete addon\.api\.gallery/);
  assert.match(
    markup,
    /chrome:\/\/zotero-platform\/content\/zotero\.css[\s\S]*gallery\.css/,
  );
});

test("exposes all requested cross-document filters", () => {
  for (const id of [
    "document-filter",
    "year-filter",
    "collection-filter",
    "type-filter",
    "keyword-filter",
  ]) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(markup, /library-filter|gallery-filter-library/);
  assert.doesNotMatch(script, /libraryFilter|populateLibraries/);
  assert.match(filters, /entry\.documentItemID/);
  assert.match(filters, /entry\.year/);
  assert.match(filters, /entry\.collectionIDs/);
  assert.match(filters, /entry\.kind/);
  assert.match(filters, /entry\.comment, entry\.tag, entry\.documentTitle/);
  assert.match(
    script,
    /select\.addEventListener\("change", scheduleFilterUpdate\)/,
  );
  assert.doesNotMatch(
    script,
    /select\.addEventListener\("input", scheduleFilterUpdate\)/,
  );
  assert.match(filters, /function countOptions\(/);
  assert.match(script, /formatGalleryOptionLabel\(label, count\)/);
  assert.match(script, /document\.createElement\("mark"\)/);
  assert.match(script, /setHighlightedText\(caption, entry\.comment\)/);
  assert.match(script, /kind\.append\(createKindIcon\(entry\.kind\)\)/);
  assert.match(script, /function createKindIcon\(kind: FigureResultKind\)/);
  assert.match(script, /M12 3v18/);
  assert.match(script, /m21 15-3\.086-3\.086/);
  assert.match(script, /M18 7V5/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.doesNotMatch(markup, /class="gallery-heading/);
  assert.doesNotMatch(markup, /class="gallery-logo/);
  assert.match(markup, /class="gallery-filters"[\s\S]*class="gallery-summary"/);
  assert.match(markup, /id="toolbar-toggle"/);
  assert.match(markup, /id="layout-mode-toggle"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /id="gallery-scale-toggle"/);
  assert.match(markup, /id="gallery-scale-popover"/);
  assert.match(markup, /id="gallery-scale-range"[^>]*type="range"/);
  assert.match(markup, /min="50"[^>]*max="200"[^>]*step="10"/);
  assert.match(markup, /id="reset-filters"/);
  assert.match(markup, /id="gallery-scale-control"[\s\S]*id="reset-filters"/);
  assert.match(markup, /data-l10n-id="gallery-reset-filters"/);
  assert.match(markup, /M3 12a9 9 0 1 0 3-6\.7L3 8/);
  assert.match(markup, /class="gallery-toolbar-toggle-icon"/);
  assert.match(markup, /<path d="m6 9 6 6 6-6"/);
  assert.match(script, /classList\.toggle\("is-collapsed"\)/);
  assert.match(script, /getViewMode\(\)/);
  assert.match(script, /setViewMode\(viewMode\)/);
  assert.match(script, /getImageScale\?\.\(\)/);
  assert.match(script, /setImageScale\?\.\(imageScale\)/);
  assert.doesNotMatch(script, /handleGalleryWheel|addEventListener\("wheel"/);
  assert.match(script, /scheduleGalleryImageScalePersistence/);
  assert.match(
    script,
    /const scrollAnchor = changed \? captureGalleryScrollAnchor\(\)/,
  );
  assert.match(script, /restoreGalleryScrollAnchor\(scrollAnchor\)/);
  assert.match(script, /viewMode === "waterfall"/);
  assert.match(
    script,
    /elements\.resetFilters\.addEventListener\("click", resetFilters\)/,
  );
  assert.match(
    script,
    /function resetFilters\(\): void \{[\s\S]*collectionFilter\.value = ""[\s\S]*documentFilter\.value = ""[\s\S]*yearFilter\.value = ""[\s\S]*typeFilter\.value = ""[\s\S]*keywordFilter\.value = ""[\s\S]*applyFilters\(\)/,
  );
  assert.match(script, /setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(script, /if \(collapsed\) elements\.keywordFilter\.focus\(\)/);
});

test("bounds rendering and lazy image work while revoking blob URLs", () => {
  assert.match(script, /const PAGE_SIZE = 60/);
  assert.match(imageCoordinator, /const DEFAULT_IMAGE_CONCURRENCY = 4/);
  assert.match(script, /new IntersectionObserver/);
  assert.match(imageCoordinator, /new BoundedAsyncTaskQueue\(/);
  assert.match(imageCoordinator, /URL\.createObjectURL\(\s*new Blob/);
  assert.match(imageCoordinator, /URL\.revokeObjectURL/);
  assert.match(script, /api\.openSource\(entryID\)/);
  assert.match(script, /"dblclick"/);
  assert.doesNotMatch(script, /"click",\s*\(\) => void openSource/);
  assert.match(script, /image\.draggable = false/);
  assert.match(
    script,
    /galleryGrid\.addEventListener\("dragstart", handleGalleryDragStart\)/,
  );
  assert.match(
    script,
    /galleryGrid\.addEventListener\("drop", handleGalleryDrop\)/,
  );
  assert.match(script, /card\.draggable = comparison/);
  assert.match(script, /header\.draggable = true/);
  assert.match(script, /reorderFigureGalleryDocuments/);
  assert.match(script, /moveFigureGalleryComparisonEntry/);
  assert.match(script, /insertFigureGalleryComparisonRow\([\s\S]*entryID/);
  assert.match(script, /insertFigureGalleryComparisonEntryAtRowEdge\(/);
  assert.match(script, /setDropTargetState\(target, getGalleryDropPosition/);
  assert.match(script, /return "inside"/);
  assert.match(script, /scheduleGalleryDragAutoScroll\(\)/);
  assert.match(script, /restoreGalleryViewport\(viewport\)/);
  assert.match(script, /renderResults\(\{ preserveComparisonCards: true \}\)/);
  assert.match(script, /function collectComparisonCardsForReuse\(\)/);
  assert.match(script, /function releaseUnusedComparisonCards\(/);
  assert.match(script, /imageObserver\?\.disconnect\(\)/);
  assert.match(
    script,
    /Math\.max\(COMPARISON_ROW_PAGE_SIZE, renderedComparisonRowCount\)/,
  );
  assert.match(
    script,
    /renderedComparisonRowCount < minimumRows[\s\S]*renderedComparisonRowCount < comparisonRows\.length/,
  );
  assert.match(script, /classList\.add\("is-drag-source"\)/);
  assert.match(script, /style\.setProperty\("display", "none", "important"\)/);
  assert.match(
    css,
    /\.gallery-grid\.is-waterfall\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--gallery-column-count, 1\), minmax\(0, 1fr\)\)/,
  );
  assert.match(css, /\.gallery-grid\s*\{[^}]*column-gap:\s*14px/);
  assert.match(
    css,
    /\.gallery-column\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*14px/,
  );
  assert.doesNotMatch(css, /(?:^|\n)\s*column-width\s*:/);
  assert.doesNotMatch(css, /break-inside\s*:/);
  assert.match(css, /\.gallery-image\s*\{[^}]*height:\s*auto/);
  assert.doesNotMatch(css, /aspect-ratio:\s*4 \/ 3/);
  assert.doesNotMatch(css, /(?:^|\n)\.gallery-caption\s*\{[^}]*min-height/);
  assert.match(
    css,
    /\.gallery-toolbar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*18px[^}]*left:\s*50%/,
  );
  assert.match(css, /width:\s*min\(calc\(100% - 36px\), 638px\)/);
  assert.match(css, /height:\s*126px/);
  assert.match(css, /height 220ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(css, /gallery-toolbar-expand-content 180ms ease-out/);
  assert.match(css, /gallery-toolbar-collapse-content 180ms ease-out/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\) 30px 30px/,
  );
  assert.match(css, /backdrop-filter:\s*blur\(18px\) saturate\(120%\)/);
  assert.match(css, /--gallery-toolbar-surface:\s*var\(--material-menu\)/);
  assert.match(css, /--gallery-control-surface:\s*var\(--material-button\)/);
  assert.match(css, /--gallery-surface:\s*var\(--material-sidepane\)/);
  assert.doesNotMatch(css, /box-shadow/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(css, /\.gallery-field-library|\.comparison-drag-handle/);
  assert.match(
    css,
    /\.gallery-field-document\s*\{[^}]*grid-column:\s*7 \/ span 3[^}]*grid-row:\s*1/,
  );
  assert.match(
    css,
    /\.gallery-field-year\s*\{[^}]*grid-column:\s*4 \/ span 3[^}]*grid-row:\s*1/,
  );
  assert.match(
    css,
    /\.gallery-field-collection\s*\{[^}]*grid-column:\s*1 \/ span 3[^}]*grid-row:\s*1/,
  );
  assert.match(
    css,
    /\.gallery-reset-filters\s*\{[^}]*grid-column:\s*11[^}]*grid-row:\s*1/,
  );
  assert.match(
    css,
    /\.gallery-scale-control\s*\{[^}]*grid-column:\s*10[^}]*grid-row:\s*1/,
  );
  assert.match(css, /\.gallery-scale-popover\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /--gallery-scale:\s*1/);
  assert.match(css, /height:\s*calc\(190px \* var\(--gallery-scale\)\)/);
  assert.match(css, /min-height:\s*calc\(304px \* var\(--gallery-scale\)\)/);
  assert.match(
    css,
    /\.gallery-toolbar\.is-collapsed \.gallery-reset-filters\s*\{[^}]*display:\s*none/,
  );
  assert.match(css, /\.gallery-summary\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.gallery-toolbar\.is-collapsed/);
  assert.match(css, /\.gallery-field:not\(\.gallery-field-search\)/);
  assert.match(css, /:not\(\.gallery-field-type\)/);
  assert.match(
    css,
    /\.gallery-toolbar\.is-collapsed \.gallery-field-type\s*\{[^}]*grid-column:\s*1/,
  );
  assert.match(css, /transform:\s*translateX\(-50%\)/);
  assert.match(
    css,
    /\.gallery-icon-button\s*\{[^}]*width:\s*30px[^}]*height:\s*30px[^}]*min-width:\s*30px[^}]*min-height:\s*30px[^}]*max-width:\s*30px[^}]*max-height:\s*30px/,
  );
  assert.match(
    css,
    /\.gallery-toolbar\.is-collapsed\s*\{[^}]*width:\s*min\(calc\(100% - 36px\), 438px\)/,
  );
  assert.doesNotMatch(css, /\.gallery-toolbar\s*\{[^}]*position:\s*sticky/);
  assert.match(script, /media\?\.classList\.add\("is-loaded"\)/);
  assert.match(script, /getFigureGalleryImageAspectRatio\(entry\.rect\)/);
  assert.match(script, /getFigureGalleryColumnCount\(/);
  assert.match(script, /findShortestFigureGalleryColumn\(/);
  assert.match(script, /appendCardsToGalleryColumns\(nextCards\)/);
  assert.match(script, /createComparisonDocumentHeader\(documentID\)/);
  assert.match(
    script,
    /appendComparisonRow\(\s*row,\s*version,\s*renderedComparisonRowCount === 0 && index === 0,\s*\)/,
  );
  assert.match(script, /classList\.toggle\("is-leading", leading\)/);
  assert.match(script, /insertFigureGalleryComparisonRow\(/);
  assert.match(script, /setFigureGalleryComparisonRowLabel\(/);
  assert.match(script, /setComparisonLayout\(committedLibraryID/);
  assert.match(script, /reflowGalleryColumns\(resizedColumnCount\)/);
  assert.match(script, /captureGalleryScrollAnchor\(\)/);
  assert.match(script, /measurementColumn\.append\(\.\.\.cards\)/);
  assert.match(css, /\.gallery-measurement\s*\{[^}]*position:\s*fixed/);
  assert.match(
    css,
    /main\s*\{[^}]*padding:\s*0 var\(--gallery-page-inline-padding\) 154px/,
  );
  assert.match(
    css,
    /\.gallery-grid\.is-document-columns\s*\{[^}]*grid-template-columns:/,
  );
  assert.match(
    css,
    /grid-template-columns:\s*var\(--comparison-label-width\)\s*repeat\(\s*var\(--comparison-document-count, 1\),\s*var\(--comparison-document-width\)\s*\)/,
  );
  assert.match(css, /--comparison-label-width:\s*120px/);
  assert.doesNotMatch(css, /--comparison-label-max-width|fit-content\(/);
  assert.doesNotMatch(
    css,
    /minmax\(var\(--comparison-document-width\),\s*1fr\)/,
  );
  assert.match(css, /\.comparison-document-header\s*\{[^}]*display:\s*flex/);
  assert.match(
    css,
    /\.comparison-row-insert-target\s*\{[^}]*grid-column:\s*1 \/ -1/,
  );
  assert.match(css, /\.comparison-cell\[data-drop-position="inside"\]/);
  assert.match(css, /\.comparison-cell\.is-drag-source\s*\{/);
  assert.match(
    css,
    /\.comparison-cell\.is-drag-source \.gallery-card\.is-dragging\s*\{[^}]*visibility:\s*hidden/,
  );
  assert.match(
    css,
    /\.comparison-cell\.is-drag-source \.comparison-thumbnail\.is-dragging\s*\{[^}]*visibility:\s*hidden/,
  );
  assert.match(
    css,
    /\.comparison-cell-content\s*\{[^}]*position:\s*relative[^}]*display:\s*flex[^}]*min-height:\s*calc\(304px \* var\(--gallery-scale\)\)[^}]*flex-direction:\s*column/,
  );
  assert.doesNotMatch(
    css,
    /\.comparison-cell-content\s*\{[^}]*(?:^|\s)(?:height|max-height):/,
  );
  assert.match(
    css,
    /\.comparison-cell-content > \.gallery-card\.is-comparison\s*\{[^}]*width:\s*100%/,
  );
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(
    css,
    /\.comparison-cell\.has-multiple[^{]*\.gallery-card-body\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail-strip\s*\{[^}]*position:\s*static[^}]*order:\s*2[^}]*width:\s*100%[^}]*height:\s*var\(--comparison-thumbnail-size\)[^}]*flex-direction:\s*row[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*hidden/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail\s*\{[^}]*width:\s*var\(--comparison-thumbnail-size\)[^}]*min-width:\s*var\(--comparison-thumbnail-size\)[^}]*height:\s*var\(--comparison-thumbnail-size\)[^}]*min-height:\s*var\(--comparison-thumbnail-size\)[^}]*aspect-ratio:\s*1 \/ 1[^}]*flex:\s*0 0 var\(--comparison-thumbnail-size\)/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail:hover,[\s\S]*\.comparison-thumbnail:focus-visible\s*\{[^}]*border-color:\s*var\(--gallery-accent\)/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail \.gallery-media\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*aspect-ratio:\s*1 \/ 1 !important/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail \.gallery-image\s*\{[^}]*height:\s*100%[^}]*object-fit:\s*contain/,
  );
  assert.match(
    css,
    /\.comparison-thumbnail \.gallery-rendered-latex\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*left:\s*50%[^}]*max-width:\s*none[^}]*transform:\s*translate\(-50%, -50%\)[^}]*--comparison-formula-scale/,
  );
  assert.match(
    css,
    /\.comparison-row-delete\s*\{[^}]*position:\s*absolute[^}]*top:\s*40px[^}]*left:\s*50%[^}]*width:\s*28px[^}]*height:\s*28px[^}]*flex:\s*0 0 28px[^}]*opacity:\s*0[^}]*transform:\s*translateX\(-50%\)/,
  );
  assert.match(
    css,
    /\.comparison-row-label-button\.is-empty\s*\{[^}]*display:\s*grid[^}]*width:\s*28px[^}]*height:\s*28px[^}]*flex:\s*0 0 28px[^}]*place-items:\s*center/,
  );
  assert.match(
    css,
    /\.comparison-row-label:hover \.comparison-row-delete,[\s\S]*\.comparison-row-delete:focus-visible\s*\{[^}]*opacity:\s*1/,
  );
  assert.match(
    css,
    /\.comparison-row-label-button:hover,[\s\S]*\.comparison-row-label-input:focus\s*\{[^}]*background:\s*var\(--gallery-control-surface-hover\)/,
  );
  assert.match(css, /data-drop-position="before"/);
  assert.match(css, /data-drop-position="after"/);
  assert.match(
    css,
    /\.comparison-row-insert-target:hover::after,[\s\S]*\.comparison-row-insert-target\.is-drop-target::after\s*\{[^}]*height:\s*2px[^}]*background:\s*var\(--gallery-accent\)[^}]*opacity:\s*1/,
  );
  assert.match(
    css,
    /\.comparison-row-insert-target\s*\{[^}]*position:\s*relative[^}]*grid-column:\s*1 \/ -1[^}]*height:\s*6px[^}]*margin:\s*0/,
  );
  assert.match(
    css,
    /\.comparison-row-insert-target::after\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*inset-inline:\s*0[^}]*height:\s*1px[^}]*background:\s*var\(--gallery-border\)[^}]*opacity:\s*1[^}]*transform:\s*translateY\(-50%\)/,
  );
  assert.match(
    css,
    /\.comparison-row-insert-target\.is-leading::after,[\s\S]*\.comparison-row-insert-target\.is-trailing::after\s*\{[^}]*opacity:\s*0/,
  );
  assert.match(
    css,
    /\.comparison-corner\s*\{[^}]*left:\s*0[^}]*border-inline-end:\s*1px solid var\(--gallery-border\)/,
  );
  assert.doesNotMatch(css, /\.comparison-axis-divider/);
  assert.match(script, /corner\.className = "comparison-corner"/);
  assert.doesNotMatch(script, /comparison-axis-divider/);
  assert.match(script, /function createComparisonPlusIcon\(\)/);
  assert.match(script, /"M12 5v14", "M5 12h14"/);
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(
    css,
    /\.comparison-row-label\s*\{[^}]*position:\s*sticky[^}]*left:\s*0[^}]*display:\s*flex[^}]*overflow:\s*hidden[^}]*padding:\s*6px 4px 0[^}]*border-inline-end:\s*1px solid var\(--gallery-border\)[^}]*background:\s*var\(--material-background\)/,
  );
  assert.match(
    css,
    /\.comparison-corner,\s*\.comparison-document-header\s*\{[^}]*min-height:\s*44px[^}]*border-bottom:\s*1px solid var\(--gallery-border\)/,
  );
  assert.match(
    css,
    /\.comparison-corner,[\s\S]*\.comparison-document-header\s*\{[^}]*background:\s*var\(--material-background\)[^}]*backdrop-filter:\s*none/,
  );
  assert.match(
    css,
    /\.comparison-row-label-button,\s*\.comparison-row-label-input\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*height:\s*auto/,
  );
  assert.match(
    css,
    /\.comparison-row-label-button\s*\{[^}]*word-break:\s*break-all/,
  );
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*--comparison-label-width:\s*96px/,
  );
  assert.match(
    css,
    /\.gallery-card\.is-comparison \.gallery-media\s*\{[^}]*height:\s*calc\(190px \* var\(--gallery-scale\)\)/,
  );
  assert.match(
    css,
    /\.comparison-cell-content > \.gallery-card\.is-comparison\s*\{[^}]*order:\s*1/,
  );
  assert.match(
    css,
    /\.comparison-pager\s*\{[^}]*display:\s*flex[^}]*width:\s*100%[^}]*justify-content:\s*center[^}]*order:\s*2/,
  );
  assert.match(
    css,
    /\.comparison-pager-button\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/,
  );
  assert.match(css, /\.comparison-pager-count\s*\{[^}]*min-width:\s*42px/);
  assert.match(
    css,
    /\.gallery-card\.is-comparison:hover\s*\{[^}]*translate:\s*none/,
  );
  assert.match(
    script,
    /"--comparison-thumbnail-size",[\s\S]*COMPARISON_THUMBNAIL_MAX_SIZE[\s\S]*COMPARISON_THUMBNAIL_MIN_SIZE,[\s\S]*documentWidth \/ 5/,
  );
  assert.match(
    script,
    /function fitComparisonThumbnailFormula\([\s\S]*availableWidth \/ contentWidth[\s\S]*availableHeight \/ contentHeight[\s\S]*"--comparison-formula-scale"/,
  );
  assert.match(
    script,
    /comparisonFormulaFitFrame = window\.requestAnimationFrame\([\s\S]*\.comparison-thumbnail \.gallery-rendered-latex/,
  );
  const resizeObserver = sourceBetween(
    "function installGalleryResizeObserver(): void {",
    "\nfunction reflowGalleryColumns(",
  );
  assert.match(
    resizeObserver,
    /applyGalleryDimensionVariables\(\);[\s\S]*if \(viewMode !== "waterfall"\) \{[\s\S]*scheduleComparisonThumbnailFormulaFit\(\);[\s\S]*return;[\s\S]*\}/,
  );
  assert.match(
    resizeObserver,
    /observe\(elements\.galleryGrid\);[\s\S]*observe\(document\.documentElement\);/,
  );
  assert.match(script, /media\.style\.aspectRatio/);
  assert.match(css, /\.gallery-media\.has-ratio \.gallery-image/);
  assert.match(script, /classList\.remove\("has-ratio", "is-failed"\)/);
  assert.match(script, /removeProperty\("aspect-ratio"\)/);
  assert.match(script, /renderLatex\(formula, latex\)/);
  assert.match(script, /subscribeFormulaLatex/);
  assert.doesNotMatch(css, /\.gallery-media\.is-failed\s*\{[^}]*min-height/);
  assert.match(loadCoordinator, /const requestID = \+\+this\.requestID/);
  assert.match(
    loadCoordinator,
    /await this\.port\.buildFilterOptions\(snapshot\)/,
  );
  assert.match(loadCoordinator, /loadedSnapshot = snapshot/);
  assert.match(loadCoordinator, /requestID === this\.requestID/);
  assert.match(
    script,
    /if \(loadedSnapshot\)[\s\S]*entriesByID\.clear\(\)[\s\S]*showState\("error"/,
  );
  assert.match(script, /catch \{[\s\S]*return messageID/);
  assert.match(script, /committedLibraryID === libraryID/);
  assert.match(filters, /function buildFacetOptions\(/);
  assert.match(script, /buildGalleryFacetState\(/);
  assert.match(script, /state\.totals\.years/);
  assert.match(
    script,
    /if \(committedLibraryID === libraryID\)[\s\S]*applyFilters\(\)/,
  );
  assert.match(imageCoordinator, /const outcome = await monitor\.promise/);
  assert.match(imageCoordinator, /loadCancellers/);
  assert.match(imageCoordinator, /monitorImageLoad/);
  assert.doesNotMatch(imageCoordinator, /function monitorImageLoad/);
  assert.match(imageLoadMonitor, /handleLoad[^;]*settle\("loaded"\)/);
  assert.doesNotMatch(imageLoadMonitor, /image\.decode\(\)/);
  assert.doesNotMatch(script, /blobURLs|activeLoads|function countOptions/);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test("supports native grouping menus and primary-image selection", () => {
  const contextMenuHandler = sourceBetween(
    "function handleGalleryContextMenu(",
    "\nasync function openGalleryContextMenu(",
  );
  assert.match(contextMenuHandler, /viewMode !== "document-columns"/);
  assert.match(contextMenuHandler, /'\[data-comparison-entry="true"\]'/);
  assert.match(
    contextMenuHandler,
    /\.closest<HTMLElement>\("\.comparison-row-label"\)/,
  );
  assert.match(contextMenuHandler, /entryElement\?\.dataset\.rowId/);
  assert.match(contextMenuHandler, /entryElement\.dataset\.entryId/);
  assert.match(contextMenuHandler, /\.comparison-row-label-input/);
  assert.match(contextMenuHandler, /\+\+galleryContextMenuRequestID/);
  assert.match(contextMenuHandler, /event\.preventDefault\(\)/);
  assert.match(contextMenuHandler, /event\.stopPropagation\(\)/);
  assert.match(contextMenuHandler, /event\.screenX,[\s\S]*event\.screenY/);

  const contextMenu = sourceBetween(
    "async function openGalleryContextMenu(",
    "\nfunction createGalleryMenuItem(",
  );
  assert.match(contextMenu, /Zotero\.getMainWindow\(\)/);
  assert.match(contextMenu, /createXULElement\(\s*"menupopup"/);
  assert.match(contextMenu, /createXULElement\("menu"\)/);
  assert.match(
    contextMenu,
    /layout\.rows\.filter\(\(\{ isGroup \}\) => isGroup\)/,
  );
  assert.match(
    contextMenu,
    /groupRows\.filter\(\(\{ id \}\) => id !== target\.rowID\)/,
  );
  assert.match(contextMenu, /requestID !== galleryContextMenuRequestID/);
  assert.match(contextMenu, /labelsByRowID\.get\(row\.id\)!/);
  assert.doesNotMatch(contextMenu, /findIndex/);
  assert.match(contextMenu, /noOtherGroupsLabel,[\s\S]*undefined,[\s\S]*true/);
  assert.match(
    contextMenu,
    /moveComparisonEntryToGroup\([\s\S]*target\.documentID![\s\S]*target\.entryID![\s\S]*row\.id/,
  );
  assert.match(contextMenu, /dissolveComparisonRow\(target\.rowID\)/);
  assert.match(contextMenu, /"popuphidden"[\s\S]*popup\.remove\(\)/);
  assert.match(contextMenu, /openPopupAtScreen\(screenX, screenY, true\)/);

  const moveToGroup = sourceBetween(
    "function moveComparisonEntryToGroup(",
    "\nfunction selectComparisonPrimaryEntry(",
  );
  assert.match(
    moveToGroup,
    /moveFigureGalleryComparisonEntry\([\s\S]*documentID,[\s\S]*entryID,[\s\S]*documentID,[\s\S]*targetRowID/,
  );

  const comparisonRow = sourceBetween(
    "function appendComparisonRow(",
    "\nfunction getVisibleComparisonCellEntries(",
  );
  assert.match(
    comparisonRow,
    /entries\.find\(\(\{ id \}\) => id === storedCell\?\.primaryEntryID\)\s*\?\?\s*entries\[0\]!/,
  );
  assert.match(comparisonRow, /if \(entries\.length === 1\)/);
  assert.match(comparisonRow, /cell\.classList\.add\("has-multiple"\)/);
  assert.match(comparisonRow, /createComparisonPager\(/);
  assert.match(
    comparisonRow,
    /content\.append\([\s\S]*card,[\s\S]*createComparisonPager\(/,
  );
  assert.doesNotMatch(comparisonRow, /content\.append\(thumbnails, card\)/);
  assert.match(
    comparisonRow,
    /if \(row\.isGroup\) labelCell\.append\(createComparisonRowDeleteControl\(row\)\)/,
  );
  assert.match(comparisonRow, /galleryGrid\.append\(labelCell\)/);
  assert.match(comparisonRow, /const cells: HTMLElement\[\] = \[\]/);
  assert.match(comparisonRow, /cells\.push\(cell\)/);
  assert.match(comparisonRow, /galleryGrid\.append\(\.\.\.cells\)/);
  assert.doesNotMatch(comparisonRow, /firstCell|has-row-label/);

  const entryConfiguration = sourceBetween(
    "function configureComparisonEntryElement(",
    "\nfunction createComparisonPager(",
  );
  for (const dataset of ["comparisonEntry", "documentId", "entryId", "rowId"]) {
    assert.match(entryConfiguration, new RegExp(`dataset\\.${dataset}`));
  }

  const rowDelete = sourceBetween(
    "function createComparisonRowDeleteControl(",
    "\nfunction createComparisonTrashIcon(",
  );
  assert.match(
    rowDelete,
    /button\.addEventListener\("click", \(event\) => \{[\s\S]*event\.stopPropagation\(\)[\s\S]*dissolveComparisonRow\(row\.id\)/,
  );

  const updateLayout = sourceBetween(
    "function updateComparisonLayout(",
    "\nfunction closeGalleryContextMenu(",
  );
  assert.match(
    updateLayout,
    /persistComparisonLayout\(\)[\s\S]*closeGalleryContextMenu\(\)[\s\S]*renderResults\(\)[\s\S]*restoreGalleryViewport\(viewport\)/,
  );
  const primarySelection = sourceBetween(
    "function selectComparisonPrimaryEntry(",
    "\nfunction dissolveComparisonRow(",
  );
  assert.match(primarySelection, /persistComparisonLayout\(\)/);
  assert.match(primarySelection, /replaceComparisonPrimaryEntryInView\(/);
  assert.match(primarySelection, /renderResults\(\)/);
  assert.match(
    primarySelection,
    /function replaceComparisonPrimaryEntryInView\([\s\S]*imageObserver\?\.unobserve\(image\)[\s\S]*imageLoader\?\.unregister\(image\)[\s\S]*oldCard\.replaceWith\(nextCard\)[\s\S]*oldPager\.replaceWith\(nextPager\)/,
  );
  assert.match(script, /gallery-comparison-previous/);
  assert.match(script, /gallery-comparison-next/);
  assert.match(
    script,
    /function dispose\(\): void \{[\s\S]*disposed = true;[\s\S]*closeGalleryContextMenu\(\)/,
  );
});
