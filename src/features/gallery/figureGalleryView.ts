import { config } from "../../../package.json";
import type {
  FigureGalleryBootstrap,
  FigureGalleryEntry,
  FigureGalleryImage,
  FigureGalleryLibrary,
  FigureGallerySnapshot,
} from "../../domain/figureGallery";
import type { FigureResultKind } from "../../domain/figureResults";
import {
  buildGalleryFilterOptions,
  filterGalleryEntries,
  formatGalleryOptionLabel,
  type CountedGalleryFilterOption,
  type GalleryFilterOptions,
} from "./galleryFilters";
import { GalleryImageLoadCoordinator } from "./galleryImageLoadCoordinator";
import { GalleryLibraryLoadCoordinator } from "./galleryLibraryLoadCoordinator";

const PAGE_SIZE = 60;
const L10N_PREFIX = `${config.addonRef}-`;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

interface FigureGalleryApi {
  getBootstrap(): FigureGalleryBootstrap | Promise<FigureGalleryBootstrap>;
  loadLibrary(libraryID: number): Promise<FigureGallerySnapshot>;
  openSource(entryID: string): Promise<void>;
  readImage(entryID: string): Promise<FigureGalleryImage>;
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

interface EntryFilterOptions extends GalleryFilterOptions {
  allLabels: readonly [string, string, string, string];
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
let libraryLoader:
  | GalleryLibraryLoadCoordinator<EntryFilterOptions>
  | undefined;
let allEntries: FigureGalleryEntry[] = [];
let filteredEntries: FigureGalleryEntry[] = [];
let entriesByID = new Map<string, FigureGalleryEntry>();
let activeKeyword = "";
let renderedCount = 0;
let renderVersion = 0;
let imageObserver: IntersectionObserver | undefined;
let sentinelObserver: IntersectionObserver | undefined;
let filterUpdateScheduled = false;
let searchTimer: number | undefined;
let committedLibraryID: number | undefined;
let disposed = false;

window.addEventListener("DOMContentLoaded", () => void initialize());
window.addEventListener("unload", dispose);

async function initialize(): Promise<void> {
  elements = collectElements();
  bindControls();
  galleryApi = resolveGalleryApi();
  if (!galleryApi) {
    showState("error", "gallery-api-unavailable");
    return;
  }

  const api = galleryApi;
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
): GalleryLibraryLoadCoordinator<EntryFilterOptions> {
  return new GalleryLibraryLoadCoordinator({
    buildFilterOptions: ({ entries }) => buildEntryFilterOptions(entries),
    commit: ({ entries, libraryID }, options) => {
      committedLibraryID = libraryID;
      allEntries = entries;
      entriesByID = new Map(entries.map((entry) => [entry.id, entry]));
      populateEntryFilters(entries, options);
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
  elements.toolbarToggle.addEventListener("click", toggleToolbar);
  for (const select of [
    elements.documentFilter,
    elements.yearFilter,
    elements.collectionFilter,
    elements.typeFilter,
  ]) {
    select.addEventListener("change", scheduleFilterUpdate);
    select.addEventListener("input", scheduleFilterUpdate);
  }
  elements.keywordFilter.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, 120);
  });
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

async function buildEntryFilterOptions(
  entries: readonly FigureGalleryEntry[],
): Promise<EntryFilterOptions> {
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
  const options = buildGalleryFilterOptions(entries, {
    figure: figureLabel,
    formula: formulaLabel,
    table: tableLabel,
  });

  return {
    allLabels: [allDocuments, allCollections, allYears, allTypes],
    ...options,
  };
}

function populateEntryFilters(
  entries: readonly FigureGalleryEntry[],
  options: EntryFilterOptions,
): void {
  const previous = {
    collection: elements.collectionFilter.value,
    document: elements.documentFilter.value,
    type: elements.typeFilter.value,
    year: elements.yearFilter.value,
  };
  const [allDocuments, allCollections, allYears, allTypes] = options.allLabels;
  populateSelect(
    elements.documentFilter,
    options.documents,
    allDocuments,
    previous.document,
    entries.length,
  );
  populateSelect(
    elements.collectionFilter,
    options.collections,
    allCollections,
    previous.collection,
    entries.length,
  );
  populateSelect(
    elements.yearFilter,
    options.years,
    allYears,
    previous.year,
    entries.length,
  );
  populateSelect(
    elements.typeFilter,
    options.kinds,
    allTypes,
    previous.type,
    entries.length,
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
  activeKeyword = elements.keywordFilter.value.trim();
  filteredEntries = filterGalleryEntries(allEntries, {
    collectionID: elements.collectionFilter.value,
    documentID: elements.documentFilter.value,
    keyword: activeKeyword,
    kind: elements.typeFilter.value,
    year: elements.yearFilter.value,
  });
  renderResults();
}

function renderResults(): void {
  renderVersion = imageLoader?.beginGeneration() ?? renderVersion + 1;
  renderedCount = 0;
  imageObserver?.disconnect();
  sentinelObserver?.disconnect();
  elements.galleryGrid.replaceChildren();
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
  createObservers(renderVersion);
  appendNextPage(renderVersion);
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
  const existingSentinel =
    elements.galleryGrid.querySelector(".gallery-sentinel");
  if (existingSentinel) sentinelObserver?.unobserve(existingSentinel);
  existingSentinel?.remove();
  const nextEntries = filteredEntries.slice(
    renderedCount,
    renderedCount + PAGE_SIZE,
  );
  const fragment = document.createDocumentFragment();
  for (const entry of nextEntries) fragment.append(createCard(entry, version));
  renderedCount += nextEntries.length;
  elements.galleryGrid.append(fragment);

  if (renderedCount < filteredEntries.length) {
    const sentinel = document.createElement("div");
    sentinel.className = "gallery-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    elements.galleryGrid.append(sentinel);
    sentinelObserver?.observe(sentinel);
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
  const image = document.createElement("img");
  image.className = "gallery-image";
  image.alt = entry.comment || entry.tag;
  image.dataset.id = entry.id;
  const imageStatus = document.createElement("span");
  imageStatus.className = "gallery-image-status";
  setLocalizedText(imageStatus, "gallery-image-loading");
  media.append(image, imageStatus);
  imageObserver?.observe(image);

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

function enqueueImage(
  entry: FigureGalleryEntry,
  image: HTMLImageElement,
  version: number,
): void {
  const status = image.nextElementSibling as HTMLElement | null;
  imageLoader?.enqueue({
    entryID: entry.id,
    generation: version,
    image,
    onFailed: () => {
      if (status) setLocalizedText(status, "gallery-image-error");
    },
    onLoaded: () => {
      image.classList.add("is-loaded");
      image.parentElement?.classList.add("is-loaded");
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
  libraryLoader?.cancel();
  renderVersion++;
  imageLoader?.dispose();
  imageObserver?.disconnect();
  sentinelObserver?.disconnect();
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
