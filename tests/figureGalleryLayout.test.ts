import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync("addon/chrome/content/gallery/index.html", "utf8");
const script = readFileSync("addon/chrome/content/gallery/gallery.js", "utf8");
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
  assert.match(script, /entry\.documentItemID/);
  assert.match(script, /entry\.year/);
  assert.match(script, /entry\.collectionIDs/);
  assert.match(script, /entry\.kind/);
  assert.match(script, /entry\.comment, entry\.tag, entry\.documentTitle/);
  assert.match(
    script,
    /select\.addEventListener\("input", scheduleFilterUpdate\)/,
  );
  assert.match(script, /function countedOptions\(/);
  assert.match(script, /formatOptionLabel\(label, count\)/);
  assert.match(script, /document\.createElement\("mark"\)/);
  assert.match(script, /setHighlightedText\(caption, entry\.comment\)/);
  assert.match(script, /kind\.append\(createKindIcon\(entry\.kind\)\)/);
  assert.match(script, /function createKindIcon\(kind\)/);
  assert.match(script, /M12 3v18/);
  assert.match(script, /m21 15-3\.086-3\.086/);
  assert.match(script, /M18 7V5/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.doesNotMatch(markup, /class="gallery-heading/);
  assert.doesNotMatch(markup, /class="gallery-logo/);
  assert.match(markup, /class="gallery-filters"[\s\S]*class="gallery-summary"/);
  assert.match(markup, /id="toolbar-toggle"/);
  assert.match(markup, /class="gallery-toolbar-toggle-icon"/);
  assert.match(markup, /<path d="m6 9 6 6 6-6"/);
  assert.match(script, /classList\.toggle\("is-collapsed"\)/);
  assert.match(script, /setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(script, /if \(collapsed\) elements\.keywordFilter\.focus\(\)/);
});

test("bounds rendering and lazy image work while revoking blob URLs", () => {
  assert.match(script, /const PAGE_SIZE = 60/);
  assert.match(script, /const IMAGE_CONCURRENCY = 4/);
  assert.match(script, /new IntersectionObserver/);
  assert.match(script, /activeImageLoads < IMAGE_CONCURRENCY/);
  assert.match(script, /URL\.createObjectURL\(\s*new Blob/);
  assert.match(script, /URL\.revokeObjectURL/);
  assert.match(script, /api\.openSource\(entryID\)/);
  assert.match(script, /style\.setProperty\("display", "none", "important"\)/);
  assert.match(css, /column-width:\s*230px/);
  assert.match(css, /column-gap:\s*14px/);
  assert.match(css, /break-inside:\s*avoid/);
  assert.match(css, /\.gallery-image\s*\{[^}]*height:\s*auto/);
  assert.doesNotMatch(css, /aspect-ratio:\s*4 \/ 3/);
  assert.doesNotMatch(css, /\.gallery-caption\s*\{[^}]*min-height/);
  assert.match(
    css,
    /\.gallery-toolbar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*18px[^}]*left:\s*50%/,
  );
  assert.match(css, /width:\s*min\(calc\(100% - 36px\), 660px\)/);
  assert.match(css, /height:\s*126px/);
  assert.match(css, /height 220ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
  assert.match(css, /gallery-toolbar-expand-content 180ms ease-out/);
  assert.match(css, /gallery-toolbar-collapse-content 180ms ease-out/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\) 30px/,
  );
  assert.match(css, /backdrop-filter:\s*blur\(18px\) saturate\(120%\)/);
  assert.match(css, /--gallery-toolbar-surface:\s*rgb\(255 255 255 \/ 88%\)/);
  assert.match(css, /\.gallery-field-library\s*\{[^}]*display:\s*none/);
  assert.match(
    css,
    /\.gallery-field-collection\s*\{[^}]*grid-column:\s*1 \/ span 3[^}]*grid-row:\s*1/,
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
  assert.doesNotMatch(css, /\.gallery-toolbar\s*\{[^}]*position:\s*sticky/);
  assert.match(script, /parentElement\?\.classList\.add\("is-loaded"\)/);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});
