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
    "library-filter",
    "document-filter",
    "year-filter",
    "collection-filter",
    "type-filter",
    "keyword-filter",
  ]) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
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
  assert.match(markup, /id="reset-filters"/);
  assert.match(markup, /data-l10n-id="gallery-reset-filters"/);
  assert.match(markup, /M3 12a9 9 0 1 0 3-6\.7L3 8/);
  assert.match(markup, /class="gallery-toolbar-toggle-icon"/);
  assert.match(markup, /<path d="m6 9 6 6 6-6"/);
  assert.match(script, /classList\.toggle\("is-collapsed"\)/);
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
  assert.match(script, /style\.setProperty\("display", "none", "important"\)/);
  assert.match(
    css,
    /\.gallery-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\([^)]*--gallery-column-count/,
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
  assert.doesNotMatch(css, /\.gallery-caption\s*\{[^}]*min-height/);
  assert.match(
    css,
    /\.gallery-toolbar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*18px[^}]*left:\s*50%/,
  );
  assert.match(css, /width:\s*min\(calc\(100% - 36px\), 600px\)/);
  assert.match(css, /height:\s*126px/);
  assert.match(css, /height 220ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(css, /gallery-toolbar-expand-content 180ms ease-out/);
  assert.match(css, /gallery-toolbar-collapse-content 180ms ease-out/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\) 30px/,
  );
  assert.match(css, /backdrop-filter:\s*blur\(18px\) saturate\(120%\)/);
  assert.match(css, /--gallery-toolbar-surface:\s*var\(--material-menu\)/);
  assert.match(css, /--gallery-control-surface:\s*var\(--material-button\)/);
  assert.match(css, /--gallery-surface:\s*var\(--material-sidepane\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.match(css, /\.gallery-field-library\s*\{[^}]*display:\s*none/);
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
    /\.gallery-reset-filters\s*\{[^}]*grid-column:\s*10[^}]*grid-row:\s*1/,
  );
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
    /\.gallery-toolbar\.is-collapsed\s*\{[^}]*width:\s*min\(calc\(100% - 36px\), 400px\)/,
  );
  assert.doesNotMatch(css, /\.gallery-toolbar\s*\{[^}]*position:\s*sticky/);
  assert.match(script, /media\?\.classList\.add\("is-loaded"\)/);
  assert.match(script, /getFigureGalleryImageAspectRatio\(entry\.rect\)/);
  assert.match(script, /getFigureGalleryColumnCount\(/);
  assert.match(script, /findShortestFigureGalleryColumn\(/);
  assert.match(script, /appendCardsToGalleryColumns\(nextCards\)/);
  assert.match(script, /reflowGalleryColumns\(resizedColumnCount\)/);
  assert.match(script, /captureGalleryScrollAnchor\(\)/);
  assert.match(script, /measurementColumn\.append\(\.\.\.cards\)/);
  assert.match(css, /\.gallery-measurement\s*\{[^}]*position:\s*fixed/);
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
  assert.match(imageLoadMonitor, /image\.decode\(\)/);
  assert.doesNotMatch(script, /blobURLs|activeLoads|function countOptions/);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});
