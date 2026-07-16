import { config } from "../../../package.json";
import type {
  FigureGalleryBootstrap,
  FigureGalleryEntry,
  FigureGalleryImage,
  FigureGalleryLibrary,
  FigureGallerySnapshot,
} from "../../domain/figureGallery";
import {
  findShortestFigureGalleryColumn,
  getFigureGalleryColumnCount,
  getFigureGalleryImageAspectRatio,
} from "../../domain/figureGallery";
import type { FigureResultKind } from "../../domain/figureResults";
import { renderLatex } from "../../utils/renderLatex";
import {
  buildGalleryFacetState,
  filterGalleryEntries,
  formatGalleryOptionLabel,
  type CountedGalleryFilterOption,
  type GalleryFacetState,
} from "./galleryFilters";
import { GalleryImageLoadCoordinator } from "./galleryImageLoadCoordinator";
import { GalleryLibraryLoadCoordinator } from "./galleryLibraryLoadCoordinator";

const PAGE_SIZE = 60;
const L10N_PREFIX = `${config.addonRef}-`;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const GALLERY_COLUMN_GAP = 14;
const GALLERY_DEFAULT_COLUMN_WIDTH = 230;
const GALLERY_RESIZE_DEBOUNCE_MS = 120;

interface FigureGalleryApi {
  getBootstrap(): FigureGalleryBootstrap | Promise<FigureGalleryBootstrap>;
  loadLibrary(libraryID: number): Promise<FigureGallerySnapshot>;
  openSource(entryID: string): Promise<void>;
  readImage(entryID: string): Promise<FigureGalleryImage>;
  subscribeFormulaLatex(
    listener: (entryID: string, latex: string) => void,
  ): () => void;
}

interface GalleryAddon {
  api?: { gallery?: FigureGalleryApi };
}

interface GalleryElements {
  collectionFilter: HTMLSelectElement;
  documentFilter: HTMLSelectElement;
  errorBanner: HTMLDivElement;
  filterToolbar: HTMLElement;
  galleryGrid: HTMLElement;
  keywordFilter: HTMLInputElement;
  libraryFilter: HTMLSelectElement;
  refresh: HTMLButtonElement;
  resetFilters: HTMLButtonElement;
  resultCount: HTMLSpanElement;
  state: HTMLElement;
  stateMessage: HTMLParagraphElement;
  toolbarToggle: HTMLButtonElement;
  typeFilter: HTMLSelectElement;
  yearFilter: HTMLSelectElement;
}

type LocalizedArguments = Record<string, number | string>;

interface GalleryLocalization {
  formatValue(
    messageID: string,
    args?: LocalizedArguments,
  ): Promise<string | null>;
  setAttributes(
    element: Element,
    messageID: string,
    args?: LocalizedArguments,
  ): void;
}

interface EntryFilterLabels {
  allLabels: readonly [string, string, string, string];
  kindLabels: Readonly<Record<FigureResultKind, string>>;
}

interface SvgPart {
  attributes: Readonly<Record<string, string>>;
  tagName: "circle" | "path" | "rect";
}

const KIND_ICON_PARTS: Readonly<Record<FigureResultKind, readonly SvgPart[]>> =
  {
    figure: [
      {
        attributes: { height: "18", rx: "2", width: "18", x: "3", y: "3" },
        tagName: "rect",
      },
      {
        attributes: { cx: "9", cy: "9", r: "2" },
        tagName: "circle",
      },
      {
        attributes: {
          d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
        },
        tagName: "path",
      },
    ],
    formula: [
      {
        attributes: {
          d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
        },
        tagName: "path",
      },
    ],
    table: [
      { attributes: { d: "M12 3v18" }, tagName: "path" },
      {
        attributes: { height: "18", rx: "2", width: "18", x: "3", y: "3" },
        tagName: "rect",
      },
      { attributes: { d: "M3 9h18" }, tagName: "path" },
      { attributes: { d: "M3 15h18" }, tagName: "path" },
    ],
  };

let galleryApi: FigureGalleryApi | undefined;
let elements: GalleryElements;
let imageLoader: GalleryImageLoadCoordinator | undefined;
let libraryLoader: GalleryLibraryLoadCoordinator<EntryFilterLabels> | undefined;
let filterLabels: EntryFilterLabels | undefined;
let allEntries: FigureGalleryEntry[] = [];
let filteredEntries: FigureGalleryEntry[] = [];
let entriesByID = new Map<string, FigureGalleryEntry>();
let activeKeyword = "";
let renderedCount = 0;
let renderVersion = 0;
let imageObserver: IntersectionObserver | undefined;
let sentinelObserver: IntersectionObserver | undefined;
let galleryResizeObserver: ResizeObserver | undefined;
let galleryResizeTimer: number | undefined;
let galleryColumnCount = 0;
let galleryColumns: HTMLElement[] = [];
let galleryColumnHeights: number[] = [];
let galleryColumnCardCounts: number[] = [];
let galleryRenderedCards: HTMLElement[] = [];
let filterUpdateScheduled = false;
let searchTimer: number | undefined;
let committedLibraryID: number | undefined;
let unsubscribeFormulaLatex: (() => void) | undefined;
let disposed = false;

window.addEventListener("DOMContentLoaded", () => void initialize());
window.addEventListener("unload", dispose);

async function initialize(): Promise<void> {
  elements = collectElements();
  bindControls();
  installGalleryResizeObserver();
  galleryApi = resolveGalleryApi();
  if (!galleryApi) {
    showState("error", "gallery-api-unavailable");
    return;
  }

  const api = galleryApi;
  unsubscribeFormulaLatex = api.subscribeFormulaLatex(applyFormulaLatexUpdate);
  imageLoader = new GalleryImageLoadCoordinator((entryID) =>
    api.readImage(entryID),
  );
  libraryLoader = createLibraryLoader(api);
  try {
    const bootstrap = await api.getBootstrap();
    if (disposed) return;
    populateLibraries(bootstrap.libraries, bootstrap.defaultLibraryID);
    if (!bootstrap.libraries.length) {
      showState("empty", "gallery-no-libraries");
      setControlsDisabled(true);
      return;
    }
    await loadLibrary(bootstrap.defaultLibraryID);
  } catch (error) {
    if (disposed) return;
    showError(error);
    showState("error", "gallery-load-error");
  }
}

function createLibraryLoader(
  api: FigureGalleryApi,
): GalleryLibraryLoadCoordinator<EntryFilterLabels> {
  return new GalleryLibraryLoadCoordinator({
    buildFilterOptions: () => buildEntryFilterLabels(),
    commit: ({ entries, libraryID }, labels) => {
      committedLibraryID = libraryID;
      allEntries = entries;
      entriesByID = new Map(entries.map((entry) => [entry.id, entry]));
      filterLabels = labels;
      applyFilters();
    },
    isSelectedLibrary: (libraryID) =>
      Number(elements.libraryFilter.value) === libraryID,
    loadSnapshot: (libraryID) => api.loadLibrary(libraryID),
    reportError: (error, libraryID, loadedSnapshot) => {
      showError(error);
      if (loadedSnapshot) {
        committedLibraryID = undefined;
        allEntries = [];
        filteredEntries = [];
        entriesByID.clear();
        renderResults();
        showState("error", "gallery-load-error");
        return;
      }
      if (committedLibraryID === libraryID) {
        applyFilters();
        return;
      }
      committedLibraryID = undefined;
      allEntries = [];
      entriesByID.clear();
      showState("error", "gallery-load-error");
    },
    setControlsDisabled,
    showLoading: () => {
      clearError();
      showState("loading", "gallery-loading");
    },
  });
}

function collectElements(): GalleryElements {
  return {
    collectionFilter: requireElement("collection-filter"),
    documentFilter: requireElement("document-filter"),
    errorBanner: requireElement("error-banner"),
    filterToolbar: requireElement("filter-toolbar"),
    galleryGrid: requireElement("gallery-grid"),
    keywordFilter: requireElement("keyword-filter"),
    libraryFilter: requireElement("library-filter"),
    refresh: requireElement("refresh"),
    resetFilters: requireElement("reset-filters"),
    resultCount: requireElement("result-count"),
    state: requireElement("state"),
    stateMessage: requireElement("state-message"),
    toolbarToggle: requireElement("toolbar-toggle"),
    typeFilter: requireElement("type-filter"),
    yearFilter: requireElement("year-filter"),
  };
}

function requireElement<ElementType extends HTMLElement>(
  id: string,
): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Gallery markup is missing #${id}`);
  return element as ElementType;
}

function resolveGalleryApi(): FigureGalleryApi | undefined {
  const registry = Zotero as typeof Zotero & Record<string, unknown>;
  const addon = registry[config.addonInstance] as GalleryAddon | undefined;
  return addon?.api?.gallery;
}

function bindControls(): void {
  elements.libraryFilter.addEventListener("change", () => {
    void loadLibrary(Number(elements.libraryFilter.value));
  });
  elements.refresh.addEventListener("click", () => {
    void loadLibrary(Number(elements.libraryFilter.value));
  });
  elements.resetFilters.addEventListener("click", resetFilters);
  elements.toolbarToggle.addEventListener("click", toggleToolbar);
  for (const select of [
    elements.documentFilter,
    elements.yearFilter,
    elements.collectionFilter,
    elements.typeFilter,
  ]) {
    select.addEventListener("change", scheduleFilterUpdate);
  }
  elements.keywordFilter.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, 120);
  });
}

function resetFilters(): void {
  window.clearTimeout(searchTimer);
  searchTimer = undefined;
  elements.collectionFilter.value = "";
  elements.documentFilter.value = "";
  elements.yearFilter.value = "";
  elements.typeFilter.value = "";
  elements.keywordFilter.value = "";
  applyFilters();
}

function toggleToolbar(): void {
  const collapsed = elements.filterToolbar.classList.toggle("is-collapsed");
  elements.toolbarToggle.setAttribute("aria-expanded", String(!collapsed));
  const messageID = collapsed
    ? "gallery-toolbar-expand"
    : "gallery-toolbar-collapse";
  const localization = getLocalization();
  if (localization) {
    localization.setAttributes(
      elements.toolbarToggle,
      `${L10N_PREFIX}${messageID}`,
    );
  } else {
    const label = collapsed ? "Show all filters" : "Minimize filters";
    elements.toolbarToggle.title = label;
    elements.toolbarToggle.setAttribute("aria-label", label);
  }
  if (collapsed) elements.keywordFilter.focus();
}

async function loadLibrary(libraryID: number): Promise<void> {
  if (disposed) return;
  window.clearTimeout(searchTimer);
  await libraryLoader?.load(libraryID);
}

function populateLibraries(
  libraries: readonly FigureGalleryLibrary[],
  selectedID: number,
): void {
  elements.libraryFilter.replaceChildren();
  for (const library of libraries) {
    const option = document.createElement("option");
    option.value = String(library.id);
    option.textContent = library.name;
    option.selected = library.id === selectedID;
    elements.libraryFilter.append(option);
  }
}

async function buildEntryFilterLabels(): Promise<EntryFilterLabels> {
  const [
    figureLabel,
    tableLabel,
    formulaLabel,
    allDocuments,
    allCollections,
    allYears,
    allTypes,
  ] = await Promise.all([
    localize("gallery-kind-figure"),
    localize("gallery-kind-table"),
    localize("gallery-kind-formula"),
    localize("gallery-filter-all-documents"),
    localize("gallery-filter-all-collections"),
    localize("gallery-filter-all-years"),
    localize("gallery-filter-all-types"),
  ]);
  return {
    allLabels: [allDocuments, allCollections, allYears, allTypes],
    kindLabels: {
      figure: figureLabel,
      formula: formulaLabel,
      table: tableLabel,
    },
  };
}

function populateEntryFilters(
  state: Readonly<GalleryFacetState>,
  labels: Readonly<EntryFilterLabels>,
): void {
  const [allDocuments, allCollections, allYears, allTypes] = labels.allLabels;
  populateSelect(
    elements.documentFilter,
    state.documents,
    allDocuments,
    state.filters.documentID,
    state.totals.documents,
  );
  populateSelect(
    elements.collectionFilter,
    state.collections,
    allCollections,
    state.filters.collectionID,
    state.totals.collections,
  );
  populateSelect(
    elements.yearFilter,
    state.years,
    allYears,
    state.filters.year,
    state.totals.years,
  );
  populateSelect(
    elements.typeFilter,
    state.kinds,
    allTypes,
    state.filters.kind,
    state.totals.kinds,
  );
}

function populateSelect(
  select: HTMLSelectElement,
  options: readonly CountedGalleryFilterOption[],
  allLabel: string,
  previousValue: string,
  total: number,
): void {
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = formatGalleryOptionLabel(allLabel, total);
  select.append(all);
  for (const [value, label, count] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatGalleryOptionLabel(label, count);
    select.append(option);
  }
  if (hasOption(select, previousValue)) select.value = previousValue;
}

function hasOption(select: HTMLSelectElement, value: string): boolean {
  for (let index = 0; index < select.options.length; index++) {
    const option = select.options.item(index) as HTMLOptionElement | null;
    if (option?.value === value) return true;
  }
  return false;
}

function scheduleFilterUpdate(): void {
  if (filterUpdateScheduled) return;
  filterUpdateScheduled = true;
  void Promise.resolve().then(() => {
    filterUpdateScheduled = false;
    if (disposed) return;
    applyFilters();
  });
}

function applyFilters(): void {
  const labels = filterLabels;
  if (!labels) return;
  const facets = buildGalleryFacetState(
    allEntries,
    {
      collectionID: elements.collectionFilter.value,
      documentID: elements.documentFilter.value,
      keyword: elements.keywordFilter.value.trim(),
      kind: elements.typeFilter.value,
      year: elements.yearFilter.value,
    },
    labels.kindLabels,
  );
  populateEntryFilters(facets, labels);
  activeKeyword = facets.filters.keyword;
  filteredEntries = filterGalleryEntries(allEntries, facets.filters);
  renderResults();
}

function renderResults(): void {
  renderVersion = imageLoader?.beginGeneration() ?? renderVersion + 1;
  renderedCount = 0;
  imageObserver?.disconnect();
  sentinelObserver?.disconnect();
  elements.galleryGrid.replaceChildren();
  galleryColumns = [];
  galleryColumnHeights = [];
  galleryColumnCardCounts = [];
  galleryRenderedCards = [];
  setLocalizedText(elements.resultCount, "gallery-result-count", {
    filtered: filteredEntries.length,
    total: allEntries.length,
  });

  if (!filteredEntries.length) {
    showState(
      "empty",
      allEntries.length ? "gallery-empty-filtered" : "gallery-empty-library",
    );
    return;
  }

  setVisible(elements.state, false);
  setVisible(elements.galleryGrid, true);
  createGalleryColumns();
  createObservers(renderVersion);
  appendNextPage(renderVersion);
}

function createGalleryColumns(
  columnCount = calculateGalleryColumnCount(),
): void {
  galleryColumnCount = columnCount;
  elements.galleryGrid.style.setProperty(
    "--gallery-column-count",
    String(galleryColumnCount),
  );
  galleryColumns = Array.from({ length: galleryColumnCount }, () => {
    const column = document.createElement("div");
    column.className = "gallery-column";
    return column;
  });
  galleryColumnHeights = galleryColumns.map(() => 0);
  galleryColumnCardCounts = galleryColumns.map(() => 0);
  elements.galleryGrid.replaceChildren(...galleryColumns);
}

function calculateGalleryColumnCount(): number {
  const width = elements.galleryGrid.getBoundingClientRect().width;
  const computedStyle = getComputedStyle(elements.galleryGrid);
  const configuredWidth = Number.parseFloat(
    computedStyle?.getPropertyValue("--gallery-column-width") ?? "",
  );
  return getFigureGalleryColumnCount(
    width,
    Number.isFinite(configuredWidth)
      ? configuredWidth
      : GALLERY_DEFAULT_COLUMN_WIDTH,
    GALLERY_COLUMN_GAP,
  );
}

function installGalleryResizeObserver(): void {
  galleryResizeObserver = new ResizeObserver(() => {
    const nextColumnCount = calculateGalleryColumnCount();
    if (
      disposed ||
      elements.galleryGrid.hidden ||
      filteredEntries.length === 0 ||
      nextColumnCount === galleryColumnCount
    ) {
      return;
    }
    window.clearTimeout(galleryResizeTimer);
    galleryResizeTimer = window.setTimeout(() => {
      galleryResizeTimer = undefined;
      if (
        disposed ||
        elements.galleryGrid.hidden ||
        filteredEntries.length === 0
      ) {
        return;
      }
      const resizedColumnCount = calculateGalleryColumnCount();
      if (resizedColumnCount !== galleryColumnCount) {
        reflowGalleryColumns(resizedColumnCount);
      }
    }, GALLERY_RESIZE_DEBOUNCE_MS);
  });
  galleryResizeObserver.observe(elements.galleryGrid);
}

function reflowGalleryColumns(columnCount: number): void {
  const scrollAnchor = captureGalleryScrollAnchor();
  removePaginationSentinel();
  createGalleryColumns(columnCount);
  appendCardsToGalleryColumns(galleryRenderedCards);
  installPaginationSentinel();
  restoreGalleryScrollAnchor(scrollAnchor);
}

interface GalleryScrollAnchor {
  card: HTMLElement;
  top: number;
}

function captureGalleryScrollAnchor(): GalleryScrollAnchor | undefined {
  let anchor: GalleryScrollAnchor | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const card of galleryRenderedCards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    const distance = Math.abs(rect.top);
    if (distance >= closestDistance) continue;
    closestDistance = distance;
    anchor = { card, top: rect.top };
  }
  return anchor;
}

function restoreGalleryScrollAnchor(
  anchor: GalleryScrollAnchor | undefined,
): void {
  if (!anchor?.card.isConnected) return;
  const offset = anchor.card.getBoundingClientRect().top - anchor.top;
  if (Number.isFinite(offset) && Math.abs(offset) >= 0.5) {
    window.scrollBy(0, offset);
  }
}

function createObservers(version: number): void {
  imageObserver = new IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        if (!change.isIntersecting) continue;
        const image = change.target as HTMLImageElement;
        imageObserver?.unobserve(image);
        const entryID = image.dataset.id;
        const entry = entryID ? entriesByID.get(entryID) : undefined;
        if (entry) enqueueImage(entry, image, version);
      }
    },
    { rootMargin: "320px 0px" },
  );
  sentinelObserver = new IntersectionObserver((changes) => {
    if (changes.some(({ isIntersecting }) => isIntersecting)) {
      appendNextPage(version);
    }
  });
}

function appendNextPage(version: number): void {
  if (version !== renderVersion || renderedCount >= filteredEntries.length) {
    return;
  }
  removePaginationSentinel();
  const nextEntries = filteredEntries.slice(
    renderedCount,
    renderedCount + PAGE_SIZE,
  );
  const nextCards = nextEntries.map((entry) => createCard(entry, version));
  appendCardsToGalleryColumns(nextCards);
  galleryRenderedCards.push(...nextCards);
  renderedCount += nextEntries.length;
  installPaginationSentinel();
}

function installPaginationSentinel(): void {
  if (renderedCount < filteredEntries.length) {
    const sentinel = document.createElement("div");
    sentinel.className = "gallery-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    elements.galleryGrid.append(sentinel);
    sentinelObserver?.observe(sentinel);
  }
}

function removePaginationSentinel(): void {
  const sentinel = elements.galleryGrid.querySelector(".gallery-sentinel");
  if (sentinel) sentinelObserver?.unobserve(sentinel);
  sentinel?.remove();
}

function appendCardsToGalleryColumns(cards: readonly HTMLElement[]): void {
  if (!cards.length) return;
  const cardHeights = measureGalleryCards(cards);
  const fragments = galleryColumns.map(() => document.createDocumentFragment());
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    const cardHeight = cardHeights[index];
    if (!card || cardHeight === undefined) continue;
    const columnIndex = findShortestFigureGalleryColumn(galleryColumnHeights);
    const fragment = fragments[columnIndex];
    if (!fragment) throw new Error("Gallery masonry column is unavailable");
    fragment.append(card);
    if (galleryColumnCardCounts[columnIndex] > 0) {
      galleryColumnHeights[columnIndex] += GALLERY_COLUMN_GAP;
    }
    galleryColumnHeights[columnIndex] += cardHeight;
    galleryColumnCardCounts[columnIndex]++;
  }
  for (let index = 0; index < galleryColumns.length; index++) {
    const column = galleryColumns[index];
    const fragment = fragments[index];
    if (column && fragment) column.append(fragment);
  }
}

function measureGalleryCards(cards: readonly HTMLElement[]): number[] {
  const measurementColumn = document.createElement("div");
  measurementColumn.className = "gallery-column gallery-measurement";
  const availableWidth = elements.galleryGrid.getBoundingClientRect().width;
  const columnWidth = Math.max(
    1,
    (availableWidth - GALLERY_COLUMN_GAP * (galleryColumnCount - 1)) /
      galleryColumnCount,
  );
  measurementColumn.style.width = `${columnWidth}px`;
  measurementColumn.append(...cards);
  document.body.append(measurementColumn);
  try {
    return cards.map((card) => card.getBoundingClientRect().height);
  } finally {
    measurementColumn.remove();
  }
}

function createCard(entry: FigureGalleryEntry, version: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "gallery-card";
  card.dataset.kind = entry.kind;
  card.dataset.id = entry.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const media = document.createElement("div");
  media.className = "gallery-media";
  const imageAspectRatio = getFigureGalleryImageAspectRatio(entry.rect);
  if (imageAspectRatio !== undefined) {
    media.classList.add("has-ratio");
    media.style.aspectRatio = String(imageAspectRatio);
  }
  const image = document.createElement("img");
  image.className = "gallery-image";
  image.alt = entry.comment || entry.tag;
  image.dataset.id = entry.id;
  const imageStatus = document.createElement("span");
  imageStatus.className = "gallery-image-status";
  setLocalizedText(imageStatus, "gallery-image-loading");
  if (entry.kind === "formula" && entry.latex) {
    renderGalleryFormula(media, entry.latex);
  } else {
    media.append(image, imageStatus);
    imageObserver?.observe(image);
  }

  const body = document.createElement("div");
  body.className = "gallery-card-body";
  const labels = document.createElement("div");
  labels.className = "gallery-card-labels";
  const kind = document.createElement("span");
  kind.className = "gallery-kind";
  kind.append(createKindIcon(entry.kind));
  const tag = document.createElement("span");
  tag.className = "gallery-tag";
  setHighlightedText(tag, entry.tag);
  tag.title = entry.tag;
  labels.append(kind, tag);

  const title = document.createElement("h2");
  title.className = "gallery-document";
  setHighlightedText(title, entry.documentTitle);
  title.title = entry.documentTitle;
  const meta = document.createElement("div");
  meta.className = "gallery-card-meta";
  if (entry.year) meta.append(textElement("span", entry.year));
  const page = document.createElement("span");
  setLocalizedText(page, "gallery-page", { page: entry.pageLabel });
  meta.append(page);
  const caption = document.createElement("p");
  caption.className = "gallery-caption";
  setHighlightedText(caption, entry.comment);
  caption.title = entry.comment;
  body.append(labels, title, meta, caption);
  card.append(media, body);

  card.addEventListener(
    "click",
    () => void openSource(card, entry.id, version),
  );
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openSource(card, entry.id, version);
  });
  return card;
}

function applyFormulaLatexUpdate(entryID: string, latex: string): void {
  if (disposed) return;
  libraryLoader?.updatePendingSnapshot(({ entries }) => {
    updateFormulaLatexEntry(entries, entryID, latex);
  });
  const entry = entriesByID.get(entryID);
  if (!entry || entry.kind !== "formula") return;
  entry.latex = latex || undefined;
  const card = galleryRenderedCards.find(
    (candidate) => candidate.dataset.id === entryID,
  );
  const media = card?.querySelector<HTMLElement>(".gallery-media");
  if (!media) return;
  const image = media.querySelector<HTMLImageElement>(".gallery-image");
  if (image) {
    imageObserver?.unobserve(image);
    imageLoader?.unregister(image);
  }
  if (latex) renderGalleryFormula(media, latex);
  else renderGalleryImage(media, entry);
  reflowGalleryColumns(galleryColumnCount);
}

function updateFormulaLatexEntry(
  entries: readonly FigureGalleryEntry[],
  entryID: string,
  latex: string,
): void {
  const entry = entries.find(({ id }) => id === entryID);
  if (entry?.kind === "formula") entry.latex = latex || undefined;
}

function renderGalleryImage(
  media: HTMLElement,
  entry: FigureGalleryEntry,
): void {
  media.classList.remove("is-latex", "is-loaded", "is-failed");
  const imageAspectRatio = getFigureGalleryImageAspectRatio(entry.rect);
  media.classList.toggle("has-ratio", imageAspectRatio !== undefined);
  if (imageAspectRatio === undefined)
    media.style.removeProperty("aspect-ratio");
  else media.style.aspectRatio = String(imageAspectRatio);
  const image = document.createElement("img");
  image.className = "gallery-image";
  image.alt = entry.comment || entry.tag;
  image.dataset.id = entry.id;
  const status = document.createElement("span");
  status.className = "gallery-image-status";
  setLocalizedText(status, "gallery-image-loading");
  media.replaceChildren(image, status);
  imageObserver?.observe(image);
}

function renderGalleryFormula(media: HTMLElement, latex: string): void {
  media.classList.remove("has-ratio", "is-failed");
  media.classList.add("is-latex", "is-loaded");
  media.style.removeProperty("aspect-ratio");
  const formula = document.createElement("div");
  formula.className = "gallery-rendered-latex";
  formula.setAttribute("aria-label", latex);
  renderLatex(formula, latex);
  media.replaceChildren(formula);
}

function enqueueImage(
  entry: FigureGalleryEntry,
  image: HTMLImageElement,
  version: number,
): void {
  const status = image.nextElementSibling as HTMLElement | null;
  const media = image.parentElement;
  imageLoader?.enqueue({
    entryID: entry.id,
    generation: version,
    image,
    onFailed: () => {
      media?.classList.add("is-failed");
      if (status) setLocalizedText(status, "gallery-image-error");
    },
    onLoaded: () => {
      image.classList.add("is-loaded");
      media?.classList.add("is-loaded");
    },
  });
}

async function openSource(
  card: HTMLElement,
  entryID: string,
  version: number,
): Promise<void> {
  const api = galleryApi;
  if (
    !api ||
    version !== renderVersion ||
    card.getAttribute("aria-busy") === "true"
  ) {
    return;
  }
  card.setAttribute("aria-busy", "true");
  clearError();
  try {
    await api.openSource(entryID);
  } catch (error) {
    if (!disposed && version === renderVersion) showError(error);
  } finally {
    if (card.isConnected) card.removeAttribute("aria-busy");
  }
}

function dispose(): void {
  disposed = true;
  window.clearTimeout(searchTimer);
  window.clearTimeout(galleryResizeTimer);
  libraryLoader?.cancel();
  unsubscribeFormulaLatex?.();
  unsubscribeFormulaLatex = undefined;
  renderVersion++;
  imageLoader?.dispose();
  imageObserver?.disconnect();
  sentinelObserver?.disconnect();
  galleryResizeObserver?.disconnect();
}

function showState(kind: string, messageID: string): void {
  setVisible(elements.galleryGrid, false);
  setVisible(elements.state, true);
  elements.state.dataset.kind = kind;
  setLocalizedText(elements.stateMessage, messageID);
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.hidden = !visible;
  if (visible) {
    element.style.removeProperty("display");
  } else {
    element.style.setProperty("display", "none", "important");
  }
}

function setControlsDisabled(disabled: boolean): void {
  const controls = document.querySelectorAll("button, input, select");
  for (let index = 0; index < controls.length; index++) {
    const control = controls.item(index) as
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!control) continue;
    if (control === elements.toolbarToggle) continue;
    control.disabled = disabled;
  }
}

function showError(error: unknown): void {
  elements.errorBanner.hidden = false;
  elements.errorBanner.textContent = getErrorMessage(error);
}

function getErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

function clearError(): void {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = "";
}

function setLocalizedText(
  element: HTMLElement,
  messageID: string,
  args?: LocalizedArguments,
): void {
  const localization = getLocalization();
  if (localization) {
    localization.setAttributes(element, `${L10N_PREFIX}${messageID}`, args);
  } else {
    void localize(messageID, args).then((text) => {
      element.textContent = text;
    });
  }
}

async function localize(
  messageID: string,
  args?: LocalizedArguments,
): Promise<string> {
  try {
    return (
      (await getLocalization()?.formatValue(
        `${L10N_PREFIX}${messageID}`,
        args,
      )) ?? messageID
    );
  } catch {
    return messageID;
  }
}

function getLocalization(): GalleryLocalization | undefined {
  return (document.l10n as unknown as GalleryLocalization | null) ?? undefined;
}

function textElement<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  text: string,
): HTMLElementTagNameMap[TagName] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function setHighlightedText(element: HTMLElement, text: string): void {
  element.replaceChildren();
  if (!activeKeyword) {
    element.textContent = text;
    return;
  }
  const normalizedText = text.toLocaleLowerCase();
  const normalizedKeyword = activeKeyword.toLocaleLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedKeyword, cursor);
    if (matchIndex < 0) break;
    if (matchIndex > cursor) {
      element.append(document.createTextNode(text.slice(cursor, matchIndex)));
    }
    const mark = document.createElement("mark");
    mark.className = "gallery-highlight";
    mark.textContent = text.slice(
      matchIndex,
      matchIndex + normalizedKeyword.length,
    );
    element.append(mark);
    cursor = matchIndex + normalizedKeyword.length;
  }
  if (cursor < text.length) {
    element.append(document.createTextNode(text.slice(cursor)));
  }
}

function createKindIcon(kind: FigureResultKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("gallery-kind-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const { attributes, tagName } of KIND_ICON_PARTS[kind]) {
    const node = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }
  return svg;
}
