"use strict";

const PAGE_SIZE = 60;
const IMAGE_CONCURRENCY = 4;
const L10N_PREFIX = "__addonRef__-";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const api = Zotero.__addonInstance__?.api?.gallery;
const elements = {};
const blobURLs = new Map();
let allEntries = [];
let filteredEntries = [];
let entriesByID = new Map();
let activeKeyword = "";
let renderedCount = 0;
let renderVersion = 0;
let imageObserver;
let sentinelObserver;
let imageQueue = [];
let activeImageLoads = 0;
let filterUpdateScheduled = false;
let searchTimer;

window.addEventListener("DOMContentLoaded", () => void initialize());
window.addEventListener("unload", cleanupImages);

async function initialize() {
  collectElements();
  bindControls();
  if (!api) {
    showState("error", "gallery-api-unavailable");
    return;
  }

  try {
    const bootstrap = await api.getBootstrap();
    populateLibraries(bootstrap.libraries, bootstrap.defaultLibraryID);
    if (!bootstrap.libraries.length) {
      showState("empty", "gallery-no-libraries");
      setControlsDisabled(true);
      return;
    }
    await loadLibrary(bootstrap.defaultLibraryID);
  } catch (error) {
    showError(error);
    showState("error", "gallery-load-error");
  }
}

function collectElements() {
  for (const id of [
    "collection-filter",
    "document-filter",
    "error-banner",
    "filter-toolbar",
    "gallery-grid",
    "keyword-filter",
    "library-filter",
    "refresh",
    "result-count",
    "state",
    "state-message",
    "toolbar-toggle",
    "type-filter",
    "year-filter",
  ]) {
    elements[toCamelCase(id)] = document.getElementById(id);
  }
}

function bindControls() {
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

function toggleToolbar() {
  const collapsed = elements.filterToolbar.classList.toggle("is-collapsed");
  elements.toolbarToggle.setAttribute("aria-expanded", String(!collapsed));
  const messageID = collapsed
    ? "gallery-toolbar-expand"
    : "gallery-toolbar-collapse";
  if (document.l10n?.setAttributes) {
    document.l10n.setAttributes(
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

async function loadLibrary(libraryID) {
  if (!Number.isInteger(libraryID)) return;
  window.clearTimeout(searchTimer);
  clearError();
  setControlsDisabled(true);
  showState("loading", "gallery-loading");
  try {
    const snapshot = await api.loadLibrary(libraryID);
    if (Number(elements.libraryFilter.value) !== snapshot.libraryID) return;
    allEntries = snapshot.entries;
    entriesByID = new Map(allEntries.map((entry) => [entry.id, entry]));
    await populateEntryFilters(allEntries);
    applyFilters();
  } catch (error) {
    allEntries = [];
    entriesByID.clear();
    showError(error);
    showState("error", "gallery-load-error");
  } finally {
    setControlsDisabled(false);
  }
}

function populateLibraries(libraries, selectedID) {
  elements.libraryFilter.replaceChildren();
  for (const library of libraries) {
    const option = document.createElement("option");
    option.value = String(library.id);
    option.textContent = library.name;
    option.selected = library.id === selectedID;
    elements.libraryFilter.append(option);
  }
}

async function populateEntryFilters(entries) {
  const previous = {
    collection: elements.collectionFilter.value,
    document: elements.documentFilter.value,
    type: elements.typeFilter.value,
    year: elements.yearFilter.value,
  };
  const documents = countedOptions(entries, (entry) => [
    [String(entry.documentItemID), entry.documentTitle],
  ]);
  const collections = countedOptions(entries, (entry) =>
    entry.collectionIDs.map((id, index) => [
      String(id),
      entry.collectionNames[index],
    ]),
  );
  const years = countedOptions(entries, (entry) =>
    entry.year ? [[entry.year, entry.year]] : [],
  ).sort((first, second) => second[0].localeCompare(first[0]));
  const kindLabels = new Map(
    await Promise.all(
      ["figure", "table", "formula"].map(async (kind) => [
        kind,
        await localize(`gallery-kind-${kind}`),
      ]),
    ),
  );
  const kinds = countedOptions(entries, (entry) => [
    [entry.kind, kindLabels.get(entry.kind)],
  ]);

  await Promise.all([
    populateSelect(
      elements.documentFilter,
      documents,
      "gallery-filter-all-documents",
      previous.document,
      entries.length,
    ),
    populateSelect(
      elements.collectionFilter,
      collections,
      "gallery-filter-all-collections",
      previous.collection,
      entries.length,
    ),
    populateSelect(
      elements.yearFilter,
      years,
      "gallery-filter-all-years",
      previous.year,
      entries.length,
    ),
    populateSelect(
      elements.typeFilter,
      kinds,
      "gallery-filter-all-types",
      previous.type,
      entries.length,
    ),
  ]);
}

async function populateSelect(
  select,
  options,
  allMessage,
  previousValue,
  total,
) {
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = formatOptionLabel(await localize(allMessage), total);
  select.append(all);
  for (const [value, label, count] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatOptionLabel(label, count);
    select.append(option);
  }
  if ([...select.options].some(({ value }) => value === previousValue)) {
    select.value = previousValue;
  }
}

function countedOptions(entries, getOptions) {
  const values = new Map();
  for (const entry of entries) {
    const seen = new Set();
    for (const [value, label] of getOptions(entry)) {
      if (!value || !label || seen.has(value)) continue;
      seen.add(value);
      const existing = values.get(value);
      values.set(value, {
        count: (existing?.count ?? 0) + 1,
        label: existing?.label ?? label,
      });
    }
  }
  return [...values]
    .map(([value, { count, label }]) => [value, label, count])
    .sort((first, second) => first[1].localeCompare(second[1]));
}

function formatOptionLabel(label, count) {
  return `${label} (${count})`;
}

function scheduleFilterUpdate() {
  if (filterUpdateScheduled) return;
  filterUpdateScheduled = true;
  void Promise.resolve().then(() => {
    filterUpdateScheduled = false;
    applyFilters();
  });
}

function applyFilters() {
  const documentID = elements.documentFilter.value;
  const year = elements.yearFilter.value;
  const collectionID = elements.collectionFilter.value;
  const kind = elements.typeFilter.value;
  activeKeyword = elements.keywordFilter.value.trim();
  const keyword = activeKeyword.toLocaleLowerCase();
  filteredEntries = allEntries.filter((entry) => {
    if (documentID && String(entry.documentItemID) !== documentID) return false;
    if (year && entry.year !== year) return false;
    if (
      collectionID &&
      !entry.collectionIDs.some((id) => String(id) === collectionID)
    ) {
      return false;
    }
    if (kind && entry.kind !== kind) return false;
    if (!keyword) return true;
    return [entry.comment, entry.tag, entry.documentTitle]
      .join("\n")
      .toLocaleLowerCase()
      .includes(keyword);
  });
  renderResults();
}

function renderResults() {
  renderVersion++;
  renderedCount = 0;
  imageQueue = [];
  cleanupImages();
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

function createObservers(version) {
  imageObserver = new IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        if (!change.isIntersecting) continue;
        imageObserver.unobserve(change.target);
        const entry = entriesByID.get(change.target.dataset.id);
        if (entry) enqueueImage(entry, change.target, version);
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

function appendNextPage(version) {
  if (version !== renderVersion || renderedCount >= filteredEntries.length) {
    return;
  }
  const existingSentinel =
    elements.galleryGrid.querySelector(".gallery-sentinel");
  if (existingSentinel) sentinelObserver.unobserve(existingSentinel);
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
    sentinelObserver.observe(sentinel);
  }
}

function createCard(entry, version) {
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
  imageObserver.observe(image);

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

function enqueueImage(entry, image, version) {
  imageQueue.push({ entry, image, version });
  pumpImages();
}

function pumpImages() {
  while (activeImageLoads < IMAGE_CONCURRENCY && imageQueue.length) {
    const task = imageQueue.shift();
    activeImageLoads++;
    void loadImage(task).finally(() => {
      activeImageLoads--;
      pumpImages();
    });
  }
}

async function loadImage({ entry, image, version }) {
  if (version !== renderVersion || !image.isConnected) return;
  const status = image.nextElementSibling;
  try {
    const payload = await api.readImage(entry.id);
    if (version !== renderVersion || !image.isConnected) return;
    const bytes = decodeBase64(payload.base64);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: payload.mimeType }),
    );
    blobURLs.set(image, url);
    image.addEventListener(
      "load",
      () => {
        image.classList.add("is-loaded");
        image.parentElement?.classList.add("is-loaded");
      },
      { once: true },
    );
    image.src = url;
  } catch (error) {
    if (version !== renderVersion || !status) return;
    setLocalizedText(status, "gallery-image-error");
  }
}

async function openSource(card, entryID, version) {
  if (version !== renderVersion || card.getAttribute("aria-busy") === "true") {
    return;
  }
  card.setAttribute("aria-busy", "true");
  clearError();
  try {
    await api.openSource(entryID);
  } catch (error) {
    showError(error);
  } finally {
    if (card.isConnected) card.removeAttribute("aria-busy");
  }
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function cleanupImages() {
  for (const url of blobURLs.values()) URL.revokeObjectURL(url);
  blobURLs.clear();
}

function showState(kind, messageID) {
  setVisible(elements.galleryGrid, false);
  setVisible(elements.state, true);
  elements.state.dataset.kind = kind;
  setLocalizedText(elements.stateMessage, messageID);
}

function setVisible(element, visible) {
  element.hidden = !visible;
  if (visible) {
    element.style.removeProperty("display");
  } else {
    element.style.setProperty("display", "none", "important");
  }
}

function setControlsDisabled(disabled) {
  for (const control of document.querySelectorAll("button, input, select")) {
    if (control === elements.toolbarToggle) continue;
    control.disabled = disabled;
  }
}

function showError(error) {
  elements.errorBanner.hidden = false;
  elements.errorBanner.textContent =
    error?.message || (error instanceof Error ? error.message : String(error));
}

function clearError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = "";
}

function setLocalizedText(element, messageID, args) {
  if (document.l10n?.setAttributes) {
    document.l10n.setAttributes(element, `${L10N_PREFIX}${messageID}`, args);
  } else {
    void localize(messageID, args).then((text) => {
      element.textContent = text;
    });
  }
}

async function localize(messageID, args) {
  return (
    (await document.l10n?.formatValue?.(`${L10N_PREFIX}${messageID}`, args)) ||
    messageID
  );
}

function textElement(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function setHighlightedText(element, text) {
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

function createKindIcon(kind) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.classList.add("gallery-kind-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const parts = {
    figure: [
      ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
      ["circle", { cx: "9", cy: "9", r: "2" }],
      ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
    ],
    formula: [
      [
        "path",
        {
          d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
        },
      ],
    ],
    table: [
      ["path", { d: "M12 3v18" }],
      ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
      ["path", { d: "M3 9h18" }],
      ["path", { d: "M3 15h18" }],
    ],
  }[kind];
  for (const [tagName, attributes] of parts) {
    const node = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }
  return svg;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
