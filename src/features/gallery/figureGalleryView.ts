import { config } from "../../../package.json";
import type {
  FigureGalleryBootstrap,
  FigureGalleryComparisonCell,
  FigureGalleryComparisonLayout,
  FigureGalleryComparisonRow,
  FigureGalleryEntry,
  FigureGalleryImage,
  FigureGallerySnapshot,
  FigureGalleryViewMode,
} from "../../domain/figureGallery";
import {
  dissolveFigureGalleryComparisonRow,
  findShortestFigureGalleryColumn,
  getFigureGalleryColumnCount,
  getFigureGalleryImageAspectRatio,
  insertFigureGalleryComparisonEntryAtRowEdge,
  insertFigureGalleryComparisonRow,
  moveFigureGalleryComparisonEntry,
  reconcileFigureGalleryComparisonLayout,
  reorderFigureGalleryDocuments,
  setFigureGalleryComparisonPrimaryEntry,
  setFigureGalleryComparisonRowLabel,
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
import {
  FIGURE_GALLERY_IMAGE_SCALE_DEFAULT,
  FIGURE_GALLERY_IMAGE_SCALE_MAX,
  FIGURE_GALLERY_IMAGE_SCALE_MIN,
} from "../../services/results/figureGalleryPreferences";

const PAGE_SIZE = 60;
const L10N_PREFIX = `${config.addonRef}-`;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const GALLERY_COLUMN_GAP = 14;
const GALLERY_DEFAULT_COLUMN_WIDTH = 230;
const GALLERY_RESIZE_DEBOUNCE_MS = 120;
const COMPARISON_ROW_PAGE_SIZE = 20;
const GALLERY_DRAG_DATA_TYPE = "application/x-zoterofigure-gallery";
const GALLERY_CONTEXT_MENU_ID = `${config.addonRef}-gallery-context-menu`;
const GALLERY_SCALE_PERSIST_DEBOUNCE_MS = 160;
const GALLERY_DRAG_SCROLL_EDGE = 64;
const GALLERY_DRAG_SCROLL_MAX_STEP = 24;
const GALLERY_CELL_DROP_EDGE_RATIO = 0.25;
const COMPARISON_THUMBNAIL_MIN_SIZE = 44;
const COMPARISON_THUMBNAIL_MAX_SIZE = 72;

interface FigureGalleryApi {
  getBootstrap(): FigureGalleryBootstrap | Promise<FigureGalleryBootstrap>;
  getComparisonLayout(
    libraryID: number,
  ): FigureGalleryComparisonLayout | undefined;
  getImageScale?: () => number;
  getViewMode(): FigureGalleryViewMode;
  loadLibrary(libraryID: number): Promise<FigureGallerySnapshot>;
  openSource(entryID: string): Promise<void>;
  readImage(entryID: string): Promise<FigureGalleryImage>;
  setComparisonLayout(
    libraryID: number,
    layout: Readonly<FigureGalleryComparisonLayout>,
  ): void;
  setImageScale?: (scale: number) => void;
  setViewMode(mode: FigureGalleryViewMode): void;
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
  scaleControl: HTMLElement;
  scalePopover: HTMLDivElement;
  scaleRange: HTMLInputElement;
  scaleToggle: HTMLButtonElement;
  scaleValue: HTMLOutputElement;
  keywordFilter: HTMLInputElement;
  layoutModeToggle: HTMLButtonElement;
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

type GalleryDropPosition = "before" | "after" | "inside";

interface GalleryDropPreview {
  position: GalleryDropPosition;
  target: HTMLElement;
}

interface GalleryViewport {
  left: number;
  top: number;
}

type GalleryContextMenuPopup = XUL.MenuPopup & {
  openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void;
};

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
let filteredEntryIDs = new Set<string>();
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
let viewMode: FigureGalleryViewMode = "waterfall";
let comparisonLayout: FigureGalleryComparisonLayout | undefined;
let comparisonRows: FigureGalleryComparisonRow[] = [];
let comparisonDocumentIDs: number[] = [];
let renderedComparisonRowCount = 0;
let comparisonCardReuse: Map<string, HTMLElement> | undefined;
let filterUpdateScheduled = false;
let searchTimer: number | undefined;
let committedLibraryID: number | undefined;
let selectedLibraryID: number | undefined;
let imageScale = FIGURE_GALLERY_IMAGE_SCALE_DEFAULT;
let imageScalePersistencePending = false;
let imageScalePersistenceTimer: number | undefined;
let comparisonFormulaFitFrame: number | undefined;
let activeDrag:
  | {
      documentID?: number;
      entryID?: string;
      kind: "document" | "entry";
    }
  | undefined;
let galleryDropPreview: GalleryDropPreview | undefined;
let galleryDragPointer: { x: number; y: number } | undefined;
let galleryDragScrollFrame: number | undefined;
let galleryContextMenu: GalleryContextMenuPopup | undefined;
let galleryContextMenuRequestID = 0;
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
  viewMode = api.getViewMode();
  setGalleryImageScale(api.getImageScale?.() ?? imageScale, false);
  updateLayoutModeControl();
  unsubscribeFormulaLatex = api.subscribeFormulaLatex(applyFormulaLatexUpdate);
  imageLoader = new GalleryImageLoadCoordinator((entryID) =>
    api.readImage(entryID),
  );
  libraryLoader = createLibraryLoader(api);
  try {
    const bootstrap = await api.getBootstrap();
    if (disposed) return;
    if (!bootstrap.libraries.length) {
      showState("empty", "gallery-no-libraries");
      setControlsDisabled(true);
      return;
    }
    selectedLibraryID = bootstrap.defaultLibraryID;
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
      comparisonLayout = reconcileFigureGalleryComparisonLayout(
        entries,
        api.getComparisonLayout(libraryID),
      );
      api.setComparisonLayout(libraryID, comparisonLayout);
      filterLabels = labels;
      applyFilters();
    },
    isSelectedLibrary: (libraryID) => selectedLibraryID === libraryID,
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
    scaleControl: requireElement("gallery-scale-control"),
    scalePopover: requireElement("gallery-scale-popover"),
    scaleRange: requireElement("gallery-scale-range"),
    scaleToggle: requireElement("gallery-scale-toggle"),
    scaleValue: requireElement("gallery-scale-value"),
    keywordFilter: requireElement("keyword-filter"),
    layoutModeToggle: requireElement("layout-mode-toggle"),
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
  elements.galleryGrid.addEventListener("dragstart", handleGalleryDragStart);
  elements.galleryGrid.addEventListener("dragover", handleGalleryDragOver);
  elements.galleryGrid.addEventListener("drop", handleGalleryDrop);
  elements.galleryGrid.addEventListener("dragend", clearGalleryDragState);
  elements.galleryGrid.addEventListener(
    "contextmenu",
    handleGalleryContextMenu,
  );
  window.addEventListener("dragover", handleGalleryWindowDragOver);
  elements.refresh.addEventListener("click", () => {
    if (selectedLibraryID !== undefined) void loadLibrary(selectedLibraryID);
  });
  elements.resetFilters.addEventListener("click", resetFilters);
  elements.scaleToggle.addEventListener("click", toggleScalePopover);
  elements.scaleRange.addEventListener("input", () => {
    setGalleryImageScale(Number(elements.scaleRange.value), true);
  });
  elements.layoutModeToggle.addEventListener("click", toggleLayoutMode);
  elements.toolbarToggle.addEventListener("click", toggleToolbar);
  document.addEventListener("pointerdown", handleScaleOutsidePointerDown);
  document.addEventListener("keydown", handleScaleKeydown);
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

function handleGalleryWindowDragOver(event: DragEvent): void {
  if (!activeDrag) return;
  galleryDragPointer = { x: event.clientX, y: event.clientY };
  scheduleGalleryDragAutoScroll();
}

function handleGalleryDragStart(event: DragEvent): void {
  if (viewMode !== "document-columns") return;
  const target = event.target;
  if (!(target instanceof Element) || !event.dataTransfer) return;
  const header = target.closest<HTMLElement>(".comparison-document-header");
  if (header?.dataset.documentId) {
    const documentID = Number(header.dataset.documentId);
    if (!Number.isInteger(documentID)) return;
    activeDrag = { documentID, kind: "document" };
    event.dataTransfer.effectAllowed = "move";
    const payload = JSON.stringify({ documentID, kind: "document" });
    event.dataTransfer.setData(GALLERY_DRAG_DATA_TYPE, payload);
    event.dataTransfer.setData("text/plain", payload);
    header.classList.add("is-dragging");
    header.setAttribute("aria-grabbed", "true");
    return;
  }

  const item = target.closest<HTMLElement>('[data-comparison-entry="true"]');
  if (!item?.dataset.documentId || !item.dataset.entryId) return;
  const documentID = Number(item.dataset.documentId);
  if (!Number.isInteger(documentID)) return;
  activeDrag = {
    documentID,
    entryID: item.dataset.entryId,
    kind: "entry",
  };
  event.dataTransfer.effectAllowed = "move";
  const payload = JSON.stringify({
    documentID,
    entryID: item.dataset.entryId,
    kind: "entry",
  });
  event.dataTransfer.setData(GALLERY_DRAG_DATA_TYPE, payload);
  event.dataTransfer.setData("text/plain", payload);
  item.classList.add("is-dragging");
  item.setAttribute("aria-grabbed", "true");
  item
    .closest<HTMLElement>(".comparison-cell")
    ?.classList.add("is-drag-source");
}

function handleGalleryDragOver(event: DragEvent): void {
  if (!activeDrag || !event.dataTransfer) return;
  galleryDragPointer = { x: event.clientX, y: event.clientY };
  scheduleGalleryDragAutoScroll();
  const target = getGalleryDropTarget(event.target);
  if (!target || !isValidGalleryDrop(activeDrag, target)) {
    clearDropTargetState();
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setDropTargetState(target, getGalleryDropPosition(event, target));
}

function handleGalleryDrop(event: DragEvent): void {
  if (!activeDrag || !comparisonLayout) return;
  const target = getGalleryDropTarget(event.target);
  if (!target || !isValidGalleryDrop(activeDrag, target)) return;
  event.preventDefault();
  const viewport = captureGalleryViewport();
  if (activeDrag.kind === "document") {
    const targetDocumentID = Number(target.dataset.documentId);
    const header = target.closest<HTMLElement>(".comparison-document-header");
    if (!header || !Number.isInteger(targetDocumentID)) return;
    const before =
      (galleryDropPreview?.position ??
        getGalleryDropPosition(event, header)) === "before";
    comparisonLayout = reorderFigureGalleryDocuments(
      comparisonLayout,
      activeDrag.documentID!,
      targetDocumentID,
      before,
    );
  } else {
    if (target.classList.contains("comparison-row-insert-target")) {
      comparisonLayout = insertFigureGalleryComparisonRow(
        comparisonLayout,
        target.dataset.beforeRowId || undefined,
        {
          documentID: activeDrag.documentID!,
          entryID: activeDrag.entryID!,
        },
      );
    } else {
      const targetDocumentID = Number(target.dataset.documentId);
      const targetRowID = target.dataset.rowId;
      if (!targetRowID || !Number.isInteger(targetDocumentID)) return;
      const dropPosition =
        galleryDropPreview?.target === target
          ? galleryDropPreview.position
          : getGalleryDropPosition(event, target);
      if (dropPosition === "inside") {
        comparisonLayout = moveFigureGalleryComparisonEntry(
          comparisonLayout,
          activeDrag.documentID!,
          activeDrag.entryID!,
          targetDocumentID,
          targetRowID,
        );
      } else {
        comparisonLayout = insertFigureGalleryComparisonEntryAtRowEdge(
          comparisonLayout,
          targetRowID,
          dropPosition,
          {
            documentID: activeDrag.documentID!,
            entryID: activeDrag.entryID!,
          },
        );
      }
    }
  }
  persistComparisonLayout();
  clearGalleryDragState();
  renderResults({ preserveComparisonCards: true });
  restoreGalleryViewport(viewport);
}

function clearGalleryDragState(): void {
  activeDrag = undefined;
  galleryDragPointer = undefined;
  if (galleryDragScrollFrame !== undefined) {
    window.cancelAnimationFrame(galleryDragScrollFrame);
    galleryDragScrollFrame = undefined;
  }
  clearDropTargetState();
  elements.galleryGrid
    .querySelectorAll<HTMLElement>(".is-dragging")
    .forEach((element) => {
      element.classList.remove("is-dragging");
      element.removeAttribute("aria-grabbed");
    });
  elements.galleryGrid
    .querySelectorAll<HTMLElement>(".is-drag-source")
    .forEach((element) => element.classList.remove("is-drag-source"));
}

function clearDropTargetState(): void {
  galleryDropPreview = undefined;
  elements.galleryGrid
    .querySelectorAll<HTMLElement>(".is-drop-target")
    .forEach((element) => {
      element.classList.remove("is-drop-target");
      element.removeAttribute("data-drop-position");
    });
}

function getGalleryDropTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return (
    target.closest<HTMLElement>(".comparison-row-insert-target") ??
    target.closest<HTMLElement>(".comparison-document-header") ??
    target.closest<HTMLElement>(".comparison-cell")
  );
}

function isValidGalleryDrop(
  drag: NonNullable<typeof activeDrag>,
  target: HTMLElement,
): boolean {
  if (drag.kind === "document") {
    return target.classList.contains("comparison-document-header");
  }
  if (target.classList.contains("comparison-row-insert-target")) return true;
  return (
    target.classList.contains("comparison-cell") &&
    Number(target.dataset.documentId) === drag.documentID
  );
}

function getGalleryDropPosition(
  event: DragEvent,
  target: HTMLElement,
): GalleryDropPosition {
  if (target.classList.contains("comparison-row-insert-target")) {
    return "inside";
  }
  const rect = target.getBoundingClientRect();
  if (target.classList.contains("comparison-document-header")) {
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }
  const edgeSize = rect.height * GALLERY_CELL_DROP_EDGE_RATIO;
  if (event.clientY < rect.top + edgeSize) return "before";
  if (event.clientY > rect.bottom - edgeSize) return "after";
  return "inside";
}

function setDropTargetState(
  target: HTMLElement,
  position: GalleryDropPosition,
): void {
  clearDropTargetState();
  target.classList.add("is-drop-target");
  target.dataset.dropPosition = position;
  galleryDropPreview = { position, target };
}

function scheduleGalleryDragAutoScroll(): void {
  if (galleryDragScrollFrame !== undefined) return;
  galleryDragScrollFrame = window.requestAnimationFrame(
    runGalleryDragAutoScroll,
  );
}

function runGalleryDragAutoScroll(): void {
  galleryDragScrollFrame = undefined;
  if (!activeDrag || !galleryDragPointer) return;
  const { x, y } = galleryDragPointer;
  const horizontalStep = getGalleryDragScrollStep(x, window.innerWidth);
  const verticalStep = getGalleryDragScrollStep(y, window.innerHeight);
  if (horizontalStep === 0 && verticalStep === 0) return;
  window.scrollBy(horizontalStep, verticalStep);
  scheduleGalleryDragAutoScroll();
}

function getGalleryDragScrollStep(
  position: number,
  viewportSize: number,
): number {
  if (!Number.isFinite(position) || !Number.isFinite(viewportSize)) return 0;
  if (position < GALLERY_DRAG_SCROLL_EDGE) {
    return -Math.ceil(
      ((GALLERY_DRAG_SCROLL_EDGE - position) / GALLERY_DRAG_SCROLL_EDGE) *
        GALLERY_DRAG_SCROLL_MAX_STEP,
    );
  }
  if (position > viewportSize - GALLERY_DRAG_SCROLL_EDGE) {
    return Math.ceil(
      ((position - (viewportSize - GALLERY_DRAG_SCROLL_EDGE)) /
        GALLERY_DRAG_SCROLL_EDGE) *
        GALLERY_DRAG_SCROLL_MAX_STEP,
    );
  }
  return 0;
}

function captureGalleryViewport(): GalleryViewport {
  return { left: window.scrollX, top: window.scrollY };
}

function restoreGalleryViewport(viewport: GalleryViewport): void {
  window.requestAnimationFrame(() => {
    window.scrollTo(viewport.left, viewport.top);
  });
}

function handleGalleryContextMenu(event: MouseEvent): void {
  if (viewMode !== "document-columns" || !comparisonLayout) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(".comparison-row-label-input")) return;
  const entryElement = target.closest<HTMLElement>(
    '[data-comparison-entry="true"]',
  );
  const labelElement = target.closest<HTMLElement>(".comparison-row-label");
  const rowID = entryElement?.dataset.rowId ?? labelElement?.dataset.rowId;
  const sourceRow = comparisonLayout.rows.find(({ id }) => id === rowID);
  if (!rowID || !sourceRow || (!entryElement && !sourceRow.isGroup)) return;

  let documentID: number | undefined;
  let entryID: string | undefined;
  if (entryElement) {
    documentID = Number(entryElement.dataset.documentId);
    entryID = entryElement.dataset.entryId;
    if (!Number.isInteger(documentID) || !entryID) return;
  }

  event.preventDefault();
  event.stopPropagation();
  const version = renderVersion;
  const requestID = ++galleryContextMenuRequestID;
  void openGalleryContextMenu(
    { documentID, entryID, rowID },
    event.screenX,
    event.screenY,
    version,
    requestID,
  ).catch(logGalleryError);
}

async function openGalleryContextMenu(
  target: { documentID?: number; entryID?: string; rowID: string },
  screenX: number,
  screenY: number,
  version: number,
  requestID: number,
): Promise<void> {
  removeGalleryContextMenu();
  const layout = comparisonLayout;
  const sourceRow = layout?.rows.find(({ id }) => id === target.rowID);
  if (!layout || !sourceRow) return;
  const groupRows = layout.rows.filter(({ isGroup }) => isGroup);
  const rowLabels = await Promise.all(
    groupRows.map(
      async (row, index) =>
        row.label ||
        (await localize("gallery-comparison-group-default", {
          index: index + 1,
        })),
    ),
  );
  const [addToGroupLabel, noOtherGroupsLabel, dissolveGroupLabel] =
    await Promise.all([
      localize("gallery-comparison-add-to-group"),
      localize("gallery-comparison-no-other-groups"),
      localize("gallery-comparison-dissolve-group"),
    ]);
  if (
    disposed ||
    requestID !== galleryContextMenuRequestID ||
    version !== renderVersion ||
    comparisonLayout !== layout ||
    !layout.rows.some(({ id }) => id === target.rowID)
  ) {
    return;
  }
  const labelsByRowID = new Map(
    groupRows.map((row, index) => [row.id, rowLabels[index]!] as const),
  );

  const ownerWindow = Zotero.getMainWindow();
  const ownerDocument = ownerWindow.document;
  const popup = ownerDocument.createXULElement(
    "menupopup",
  ) as GalleryContextMenuPopup;
  popup.id = GALLERY_CONTEXT_MENU_ID;

  if (target.entryID && target.documentID !== undefined) {
    const groupMenu = ownerDocument.createXULElement("menu");
    groupMenu.setAttribute("label", addToGroupLabel);
    const groupPopup = ownerDocument.createXULElement("menupopup");
    const targetRows = groupRows.filter(({ id }) => id !== target.rowID);
    if (!targetRows.length) {
      groupPopup.append(
        createGalleryMenuItem(
          ownerDocument,
          noOtherGroupsLabel,
          undefined,
          true,
        ),
      );
    } else {
      for (const row of targetRows) {
        groupPopup.append(
          createGalleryMenuItem(
            ownerDocument,
            labelsByRowID.get(row.id)!,
            () => {
              moveComparisonEntryToGroup(
                target.documentID!,
                target.entryID!,
                row.id,
              );
            },
          ),
        );
      }
    }
    groupMenu.append(groupPopup);
    popup.append(groupMenu);
  }

  if (sourceRow.isGroup) {
    if (target.entryID) {
      popup.append(ownerDocument.createXULElement("menuseparator"));
    }
    popup.append(
      createGalleryMenuItem(ownerDocument, dissolveGroupLabel, () => {
        dissolveComparisonRow(target.rowID);
      }),
    );
  }
  const container =
    ownerDocument.querySelector("#browser") ?? ownerDocument.documentElement;
  container.append(popup);
  galleryContextMenu = popup;
  popup.addEventListener(
    "popuphidden",
    () => {
      popup.remove();
      if (galleryContextMenu === popup) galleryContextMenu = undefined;
    },
    { once: true },
  );
  popup.openPopupAtScreen(screenX, screenY, true);
}

function createGalleryMenuItem(
  ownerDocument: Document,
  label: string,
  command?: () => void,
  disabled = false,
): XULElement {
  const item = ownerDocument.createXULElement("menuitem") as XULElement;
  item.setAttribute("label", label);
  if (disabled) item.setAttribute("disabled", "true");
  if (command) {
    item.addEventListener("command", () => {
      try {
        command();
      } catch (error) {
        logGalleryError(error);
      }
    });
  }
  return item;
}

function moveComparisonEntryToGroup(
  documentID: number,
  entryID: string,
  targetRowID: string,
): void {
  updateComparisonLayout((layout) =>
    moveFigureGalleryComparisonEntry(
      layout,
      documentID,
      entryID,
      documentID,
      targetRowID,
    ),
  );
}

function selectComparisonPrimaryEntry(
  rowID: string,
  documentID: number,
  entryID: string,
): void {
  if (!comparisonLayout) return;
  comparisonLayout = setFigureGalleryComparisonPrimaryEntry(
    comparisonLayout,
    rowID,
    documentID,
    entryID,
  );
  persistComparisonLayout();
  closeGalleryContextMenu();
  if (replaceComparisonPrimaryEntryInView(rowID, documentID, entryID)) return;
  const viewport = captureGalleryViewport();
  renderResults();
  restoreGalleryViewport(viewport);
}

function replaceComparisonPrimaryEntryInView(
  rowID: string,
  documentID: number,
  entryID: string,
): boolean {
  const cells =
    elements.galleryGrid.querySelectorAll<HTMLElement>(".comparison-cell");
  let cell: HTMLElement | undefined;
  for (let index = 0; index < cells.length; index++) {
    const candidate = cells.item(index);
    if (
      candidate.dataset.rowId === rowID &&
      candidate.dataset.documentId === String(documentID)
    ) {
      cell = candidate;
      break;
    }
  }
  const content = cell?.querySelector<HTMLElement>(".comparison-cell-content");
  const oldCard = content?.querySelector<HTMLElement>(
    ".gallery-card.is-comparison",
  );
  const oldPager = content?.querySelector<HTMLElement>(".comparison-pager");
  const row = comparisonLayout?.rows.find(({ id }) => id === rowID);
  const storedCell = row?.entries[String(documentID)];
  const entries = getVisibleComparisonCellEntries(storedCell);
  const entry = entries.find(({ id }) => id === entryID);
  if (!content || !oldCard || !oldPager || !entry) return false;

  const nextCard = createCard(entry, renderVersion, true);
  configureComparisonEntryElement(nextCard, entry, rowID, documentID);
  const nextPager = createComparisonPager(
    entries,
    entryID,
    rowID,
    documentID,
    renderVersion,
  );
  for (const image of oldCard.querySelectorAll(".gallery-image")) {
    if (!(image instanceof HTMLImageElement)) continue;
    imageObserver?.unobserve(image);
    imageLoader?.unregister(image);
  }
  const cardIndex = galleryRenderedCards.indexOf(oldCard);
  if (cardIndex >= 0) galleryRenderedCards[cardIndex] = nextCard;
  oldCard.replaceWith(nextCard);
  oldPager.replaceWith(nextPager);
  return true;
}

function dissolveComparisonRow(rowID: string): void {
  updateComparisonLayout((layout) =>
    dissolveFigureGalleryComparisonRow(layout, rowID),
  );
}

function updateComparisonLayout(
  update: (
    layout: Readonly<FigureGalleryComparisonLayout>,
  ) => FigureGalleryComparisonLayout,
): void {
  if (!comparisonLayout) return;
  const viewport = captureGalleryViewport();
  comparisonLayout = update(comparisonLayout);
  persistComparisonLayout();
  closeGalleryContextMenu();
  renderResults();
  restoreGalleryViewport(viewport);
}

function closeGalleryContextMenu(): void {
  galleryContextMenuRequestID++;
  removeGalleryContextMenu();
}

function removeGalleryContextMenu(): void {
  const menu = galleryContextMenu;
  galleryContextMenu = undefined;
  menu?.remove();
}

function logGalleryError(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
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
  if (collapsed) closeScalePopover();
  if (collapsed) elements.keywordFilter.focus();
}

function toggleScalePopover(): void {
  const open = elements.scalePopover.hidden;
  elements.scalePopover.hidden = !open;
  elements.scaleToggle.setAttribute("aria-expanded", String(open));
  if (open) elements.scaleRange.focus();
}

function closeScalePopover(): void {
  if (elements.scalePopover.hidden) return;
  elements.scalePopover.hidden = true;
  elements.scaleToggle.setAttribute("aria-expanded", "false");
}

function handleScaleOutsidePointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && elements.scaleControl.contains(target)) return;
  closeScalePopover();
}

function handleScaleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || elements.scalePopover.hidden) return;
  closeScalePopover();
  elements.scaleToggle.focus();
}

function setGalleryImageScale(value: number, persist: boolean): void {
  const next = normalizeGalleryImageScale(value);
  const changed = next !== imageScale;
  const scrollAnchor = changed ? captureGalleryScrollAnchor() : undefined;
  imageScale = next;
  elements.scaleRange.value = String(next);
  elements.scaleValue.textContent = `${next}%`;
  applyGalleryDimensionVariables();
  if (viewMode === "document-columns") {
    scheduleComparisonThumbnailFormulaFit();
  }
  if (persist) scheduleGalleryImageScalePersistence();
  if (!changed || !galleryRenderedCards.length || galleryColumnCount <= 0) {
    if (changed && viewMode === "document-columns") {
      restoreGalleryScrollAnchor(scrollAnchor);
    }
    return;
  }
  if (viewMode === "waterfall") {
    reflowGalleryColumns(calculateGalleryColumnCount(), scrollAnchor);
  } else {
    restoreGalleryScrollAnchor(scrollAnchor);
  }
}

function scheduleGalleryImageScalePersistence(): void {
  imageScalePersistencePending = true;
  window.clearTimeout(imageScalePersistenceTimer);
  imageScalePersistenceTimer = window.setTimeout(
    flushGalleryImageScalePersistence,
    GALLERY_SCALE_PERSIST_DEBOUNCE_MS,
  );
}

function flushGalleryImageScalePersistence(): void {
  window.clearTimeout(imageScalePersistenceTimer);
  imageScalePersistenceTimer = undefined;
  if (!imageScalePersistencePending) return;
  imageScalePersistencePending = false;
  galleryApi?.setImageScale?.(imageScale);
}

function normalizeGalleryImageScale(value: number): number {
  if (!Number.isFinite(value)) return FIGURE_GALLERY_IMAGE_SCALE_DEFAULT;
  return Math.min(
    FIGURE_GALLERY_IMAGE_SCALE_MAX,
    Math.max(FIGURE_GALLERY_IMAGE_SCALE_MIN, Math.round(value)),
  );
}

function applyGalleryDimensionVariables(): void {
  const scale = imageScale / 100;
  elements.galleryGrid.style.setProperty("--gallery-scale", String(scale));
  const computedStyle = getComputedStyle(elements.galleryGrid);
  const baseColumnWidth = parseGalleryDimension(
    computedStyle?.getPropertyValue("--gallery-base-column-width") ?? "",
    GALLERY_DEFAULT_COLUMN_WIDTH,
  );
  elements.galleryGrid.style.setProperty(
    "--gallery-column-width",
    `${baseColumnWidth * scale}px`,
  );
  const baseDocumentWidth = parseGalleryDimension(
    computedStyle?.getPropertyValue("--comparison-base-document-width") ?? "",
    286,
  );
  const documentWidth = baseDocumentWidth * scale;
  elements.galleryGrid.style.setProperty(
    "--comparison-document-width",
    `${documentWidth}px`,
  );
  elements.galleryGrid.style.setProperty(
    "--comparison-thumbnail-size",
    `${Math.min(
      COMPARISON_THUMBNAIL_MAX_SIZE,
      Math.max(COMPARISON_THUMBNAIL_MIN_SIZE, documentWidth / 5),
    )}px`,
  );
}

function parseGalleryDimension(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toggleLayoutMode(): void {
  viewMode = viewMode === "waterfall" ? "document-columns" : "waterfall";
  galleryApi?.setViewMode(viewMode);
  updateLayoutModeControl();
  renderResults();
}

function updateLayoutModeControl(): void {
  const documentColumnsActive = viewMode === "document-columns";
  elements.layoutModeToggle.setAttribute(
    "aria-pressed",
    String(documentColumnsActive),
  );
  elements.layoutModeToggle.dataset.mode = viewMode;
  const messageID = documentColumnsActive
    ? "gallery-view-switch-to-waterfall"
    : "gallery-view-switch-to-documents";
  const localization = getLocalization();
  if (localization) {
    localization.setAttributes(
      elements.layoutModeToggle,
      `${L10N_PREFIX}${messageID}`,
    );
  } else {
    const label = documentColumnsActive
      ? "Switch to waterfall view"
      : "Switch to document columns";
    elements.layoutModeToggle.title = label;
    elements.layoutModeToggle.setAttribute("aria-label", label);
  }
}

async function loadLibrary(libraryID: number): Promise<void> {
  if (disposed) return;
  selectedLibraryID = libraryID;
  window.clearTimeout(searchTimer);
  await libraryLoader?.load(libraryID);
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
  filteredEntryIDs = new Set(filteredEntries.map(({ id }) => id));
  renderResults();
}

function renderResults(
  options: { preserveComparisonCards?: boolean } = {},
): void {
  const preserveComparisonCards =
    options.preserveComparisonCards === true && viewMode === "document-columns";
  const reusableCards = preserveComparisonCards
    ? collectComparisonCardsForReuse()
    : undefined;
  closeGalleryContextMenu();
  const minimumComparisonRows =
    viewMode === "document-columns"
      ? Math.max(COMPARISON_ROW_PAGE_SIZE, renderedComparisonRowCount)
      : COMPARISON_ROW_PAGE_SIZE;
  if (!preserveComparisonCards) {
    renderVersion = imageLoader?.beginGeneration() ?? renderVersion + 1;
  }
  renderedCount = 0;
  renderedComparisonRowCount = 0;
  if (!preserveComparisonCards) imageObserver?.disconnect();
  sentinelObserver?.disconnect();
  comparisonCardReuse = reusableCards;
  elements.galleryGrid.replaceChildren();
  galleryColumns = [];
  galleryColumnHeights = [];
  galleryColumnCardCounts = [];
  galleryRenderedCards = [];
  comparisonRows = [];
  comparisonDocumentIDs = [];
  elements.galleryGrid.classList.toggle(
    "is-document-columns",
    viewMode === "document-columns",
  );
  elements.galleryGrid.classList.toggle(
    "is-waterfall",
    viewMode === "waterfall",
  );
  applyGalleryDimensionVariables();
  setLocalizedText(elements.resultCount, "gallery-result-count", {
    filtered: filteredEntries.length,
    total: allEntries.length,
  });

  if (!filteredEntries.length) {
    comparisonCardReuse = undefined;
    releaseUnusedComparisonCards(reusableCards);
    showState(
      "empty",
      allEntries.length ? "gallery-empty-filtered" : "gallery-empty-library",
    );
    return;
  }

  setVisible(elements.state, false);
  setVisible(elements.galleryGrid, true);
  if (viewMode === "document-columns") {
    createComparisonBoard(
      renderVersion,
      minimumComparisonRows,
      preserveComparisonCards,
    );
    comparisonCardReuse = undefined;
    releaseUnusedComparisonCards(reusableCards);
    return;
  }
  comparisonCardReuse = undefined;
  releaseUnusedComparisonCards(reusableCards);
  createGalleryColumns();
  createObservers(renderVersion);
  appendNextPage(renderVersion);
}

function createComparisonBoard(
  version: number,
  minimumRows: number,
  preserveComparisonCards = false,
): void {
  const layout = comparisonLayout;
  if (!layout) return;
  const filteredDocumentIDs = new Set(
    filteredEntries.map(({ documentItemID }) => documentItemID),
  );
  comparisonDocumentIDs = layout.documentOrder.filter((documentID) =>
    filteredDocumentIDs.has(documentID),
  );
  const filtersActive = filteredEntries.length !== allEntries.length;
  comparisonRows = layout.rows.filter((row) => {
    const hasVisibleEntry = comparisonDocumentIDs.some((documentID) => {
      const cell = row.entries[String(documentID)];
      return cell?.entryIDs.some((entryID) => filteredEntryIDs.has(entryID));
    });
    return (
      hasVisibleEntry ||
      (!filtersActive && Object.keys(row.entries).length === 0)
    );
  });
  elements.galleryGrid.style.setProperty(
    "--comparison-document-count",
    String(comparisonDocumentIDs.length),
  );
  const corner = document.createElement("div");
  corner.className = "comparison-corner";
  const cornerLabel = document.createElement("span");
  cornerLabel.className = "comparison-corner-label";
  setLocalizedText(cornerLabel, "gallery-comparison-rows");
  corner.append(cornerLabel);
  elements.galleryGrid.append(corner);
  for (const documentID of comparisonDocumentIDs) {
    elements.galleryGrid.append(createComparisonDocumentHeader(documentID));
  }
  if (!preserveComparisonCards) createObservers(version);
  do {
    appendNextComparisonRows(version);
  } while (
    renderedComparisonRowCount < minimumRows &&
    renderedComparisonRowCount < comparisonRows.length
  );
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
    if (disposed || elements.galleryGrid.hidden) return;
    applyGalleryDimensionVariables();
    if (viewMode !== "waterfall") {
      scheduleComparisonThumbnailFormulaFit();
      return;
    }
    const nextColumnCount = calculateGalleryColumnCount();
    if (
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
  galleryResizeObserver.observe(document.documentElement);
}

function reflowGalleryColumns(
  columnCount: number,
  scrollAnchor = captureGalleryScrollAnchor(),
): void {
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
  if (viewMode === "document-columns") {
    appendNextComparisonRows(version);
    return;
  }
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

function appendNextComparisonRows(version: number): void {
  if (
    version !== renderVersion ||
    renderedComparisonRowCount >= comparisonRows.length
  ) {
    return;
  }
  removePaginationSentinel();
  removeTrailingComparisonInsertTarget();
  const nextRows = comparisonRows.slice(
    renderedComparisonRowCount,
    renderedComparisonRowCount + COMPARISON_ROW_PAGE_SIZE,
  );
  for (let index = 0; index < nextRows.length; index++) {
    const row = nextRows[index];
    if (!row) continue;
    appendComparisonRow(
      row,
      version,
      renderedComparisonRowCount === 0 && index === 0,
    );
  }
  renderedComparisonRowCount += nextRows.length;
  elements.galleryGrid.append(createComparisonInsertTarget(undefined));
  installPaginationSentinel();
}

function installPaginationSentinel(): void {
  const hasMore =
    viewMode === "document-columns"
      ? renderedComparisonRowCount < comparisonRows.length
      : renderedCount < filteredEntries.length;
  if (hasMore) {
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

function createComparisonDocumentHeader(documentID: number): HTMLElement {
  const entry =
    filteredEntries.find(
      ({ documentItemID }) => documentItemID === documentID,
    ) ?? allEntries.find(({ documentItemID }) => documentItemID === documentID);
  if (!entry) throw new Error("Comparison document is unavailable");
  const header = document.createElement("header");
  header.className = "comparison-document-header";
  header.draggable = true;
  header.dataset.documentId = String(documentID);

  const text = document.createElement("div");
  text.className = "comparison-document-text";
  const title = document.createElement("h2");
  title.textContent = entry.documentTitle;
  title.title = entry.documentTitle;
  const meta = document.createElement("div");
  meta.className = "comparison-document-meta";
  if (entry.year) meta.append(textElement("span", entry.year));
  const resultCount = filteredEntries.filter(
    ({ documentItemID }) => documentItemID === documentID,
  ).length;
  const count = document.createElement("span");
  setLocalizedText(count, "gallery-comparison-result-count", {
    count: resultCount,
  });
  meta.append(count);
  text.append(title, meta);
  header.append(text);
  return header;
}

function collectComparisonCardsForReuse(): Map<string, HTMLElement> {
  const cards = new Map<string, HTMLElement>();
  const renderedCards = elements.galleryGrid.querySelectorAll<HTMLElement>(
    ".gallery-card.is-comparison[data-id]",
  );
  for (let index = 0; index < renderedCards.length; index++) {
    const card = renderedCards.item(index);
    const entryID = card.dataset.id;
    if (entryID && !cards.has(entryID)) cards.set(entryID, card);
  }
  return cards;
}

function takeReusableComparisonCard(entryID: string): HTMLElement | undefined {
  const card = comparisonCardReuse?.get(entryID);
  if (card) comparisonCardReuse?.delete(entryID);
  return card;
}

function releaseUnusedComparisonCards(
  cards: Map<string, HTMLElement> | undefined,
): void {
  if (!cards) return;
  for (const card of cards.values()) {
    if (card.isConnected) continue;
    for (const image of card.querySelectorAll(".gallery-image")) {
      if (!(image instanceof HTMLImageElement)) continue;
      imageObserver?.unobserve(image);
      imageLoader?.unregister(image);
    }
  }
}

function appendComparisonRow(
  row: FigureGalleryComparisonRow,
  version: number,
  leading: boolean,
): void {
  const insertTarget = createComparisonInsertTarget(row.id);
  insertTarget.classList.toggle("is-leading", leading);
  elements.galleryGrid.append(insertTarget);
  const labelCell = document.createElement("div");
  labelCell.className = "comparison-row-label";
  labelCell.dataset.rowId = row.id;
  labelCell.append(createComparisonRowLabelControl(row));
  if (row.isGroup) labelCell.append(createComparisonRowDeleteControl(row));
  elements.galleryGrid.append(labelCell);

  const cells: HTMLElement[] = [];
  for (const documentID of comparisonDocumentIDs) {
    const cell = document.createElement("div");
    cell.className = "comparison-cell";
    cell.dataset.documentId = String(documentID);
    cell.dataset.rowId = row.id;
    const storedCell = row.entries[String(documentID)];
    const entries = getVisibleComparisonCellEntries(storedCell);
    if (entries.length) {
      const primaryEntry =
        entries.find(({ id }) => id === storedCell?.primaryEntryID) ??
        entries[0]!;
      const card =
        takeReusableComparisonCard(primaryEntry.id) ??
        createCard(primaryEntry, version, true);
      configureComparisonEntryElement(card, primaryEntry, row.id, documentID);
      galleryRenderedCards.push(card);
      if (entries.length === 1) {
        cell.append(card);
      } else {
        cell.classList.add("has-multiple");
        const content = document.createElement("div");
        content.className = "comparison-cell-content";
        content.append(
          card,
          createComparisonPager(
            entries,
            primaryEntry.id,
            row.id,
            documentID,
            version,
          ),
        );
        cell.append(content);
      }
      renderedCount += entries.length;
    } else {
      cell.classList.add("is-empty");
    }
    cells.push(cell);
  }
  elements.galleryGrid.append(...cells);
}

function getVisibleComparisonCellEntries(
  cell: Readonly<FigureGalleryComparisonCell> | undefined,
): FigureGalleryEntry[] {
  if (!cell) return [];
  const entries: FigureGalleryEntry[] = [];
  for (const entryID of cell.entryIDs) {
    if (!filteredEntryIDs.has(entryID)) continue;
    const entry = entriesByID.get(entryID);
    if (entry) entries.push(entry);
  }
  return entries;
}

function configureComparisonEntryElement(
  element: HTMLElement,
  entry: FigureGalleryEntry,
  rowID: string,
  documentID: number,
): void {
  element.dataset.comparisonEntry = "true";
  element.dataset.documentId = String(documentID);
  element.dataset.entryId = entry.id;
  element.dataset.rowId = rowID;
}

function createComparisonPager(
  entries: readonly FigureGalleryEntry[],
  primaryEntryID: string,
  rowID: string,
  documentID: number,
  version: number,
): HTMLElement {
  const pager = document.createElement("nav");
  pager.className = "comparison-pager";
  pager.setAttribute("aria-label", "Comparison images");
  const currentIndex = Math.max(
    0,
    entries.findIndex(({ id }) => id === primaryEntryID),
  );
  const previous = createComparisonPagerButton(
    "previous",
    currentIndex <= 0,
    () => {
      if (version !== renderVersion) return;
      const entry = entries[currentIndex - 1];
      if (entry) selectComparisonPrimaryEntry(rowID, documentID, entry.id);
    },
  );
  const count = document.createElement("span");
  count.className = "comparison-pager-count";
  count.textContent = `${currentIndex + 1} / ${entries.length}`;
  const next = createComparisonPagerButton(
    "next",
    currentIndex >= entries.length - 1,
    () => {
      if (version !== renderVersion) return;
      const entry = entries[currentIndex + 1];
      if (entry) selectComparisonPrimaryEntry(rowID, documentID, entry.id);
    },
  );
  pager.append(previous, count, next);
  return pager;
}

function createComparisonPagerButton(
  direction: "previous" | "next",
  disabled: boolean,
  command: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "comparison-pager-button";
  button.type = "button";
  button.disabled = disabled;
  setLocalizedControl(
    button,
    direction === "previous"
      ? "gallery-comparison-previous"
      : "gallery-comparison-next",
  );
  button.append(createComparisonPagerIcon(direction));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    command();
  });
  return button;
}

function createComparisonPagerIcon(
  direction: "previous" | "next",
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute(
    "d",
    direction === "previous" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6",
  );
  svg.append(path);
  return svg;
}

function createComparisonRowDeleteControl(
  row: FigureGalleryComparisonRow,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "comparison-row-delete";
  button.type = "button";
  button.title = "Dissolve group";
  button.setAttribute("aria-label", "Dissolve group");
  void localize("gallery-comparison-dissolve-group").then((label) => {
    if (!button.isConnected) return;
    button.title = label;
    button.setAttribute("aria-label", label);
  });
  button.append(createComparisonTrashIcon());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    dissolveComparisonRow(row.id);
  });
  return button;
}

function createComparisonTrashIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of [
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  ]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function createComparisonPlusIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M12 5v14", "M5 12h14"]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function createComparisonRowLabelControl(
  row: FigureGalleryComparisonRow,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "comparison-row-label-button";
  button.type = "button";
  if (row.label) {
    button.textContent = row.label;
    button.title = row.label;
  } else {
    button.classList.add("is-empty");
    button.append(createComparisonPlusIcon());
    setLocalizedControl(button, "gallery-comparison-name-row");
  }
  button.addEventListener("click", () =>
    startComparisonRowLabelEdit(row, button),
  );
  return button;
}

function startComparisonRowLabelEdit(
  row: FigureGalleryComparisonRow,
  button: HTMLButtonElement,
): void {
  const input = document.createElement("input");
  input.className = "comparison-row-label-input";
  input.type = "text";
  input.maxLength = 160;
  input.value = row.label;
  setLocalizedControl(input, "gallery-comparison-row-label");
  let cancelled = false;
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key !== "Escape") return;
    cancelled = true;
    input.replaceWith(createComparisonRowLabelControl(row));
  });
  input.addEventListener("blur", () => {
    if (cancelled || !comparisonLayout) return;
    comparisonLayout = setFigureGalleryComparisonRowLabel(
      comparisonLayout,
      row.id,
      input.value,
    );
    persistComparisonLayout();
    renderResults();
  });
  button.replaceWith(input);
  input.focus();
  input.select();
}

function createComparisonInsertTarget(
  beforeRowID: string | undefined,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "comparison-row-insert-target";
  button.type = "button";
  button.draggable = false;
  button.dataset.beforeRowId = beforeRowID ?? "";
  button.classList.toggle("is-trailing", beforeRowID === undefined);
  setLocalizedControl(button, "gallery-comparison-add-row");
  button.addEventListener("click", () => {
    if (!comparisonLayout) return;
    comparisonLayout = insertFigureGalleryComparisonRow(
      comparisonLayout,
      beforeRowID,
    );
    persistComparisonLayout();
    renderResults();
  });
  return button;
}

function removeTrailingComparisonInsertTarget(): void {
  elements.galleryGrid
    .querySelector(".comparison-row-insert-target.is-trailing")
    ?.remove();
}

function persistComparisonLayout(): void {
  if (committedLibraryID === undefined || !comparisonLayout) return;
  galleryApi?.setComparisonLayout(committedLibraryID, comparisonLayout);
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
  const renderedColumnWidth =
    galleryColumns[0]?.getBoundingClientRect().width ?? Number.NaN;
  const columnWidth =
    Number.isFinite(renderedColumnWidth) && renderedColumnWidth > 0
      ? renderedColumnWidth
      : Math.max(
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

function createCard(
  entry: FigureGalleryEntry,
  version: number,
  comparison = false,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "gallery-card";
  card.classList.toggle("is-comparison", comparison);
  card.draggable = comparison;
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
  image.draggable = false;
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
  if (!comparison && entry.year) meta.append(textElement("span", entry.year));
  const page = document.createElement("span");
  setLocalizedText(page, "gallery-page", { page: entry.pageLabel });
  meta.append(page);
  const caption = document.createElement("p");
  caption.className = "gallery-caption";
  setHighlightedText(caption, entry.comment);
  caption.title = entry.comment;
  if (comparison) body.append(labels, meta, caption);
  else body.append(labels, title, meta, caption);
  card.append(media, body);

  card.addEventListener(
    "dblclick",
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
  if (viewMode === "document-columns") {
    const viewport = captureGalleryViewport();
    renderResults();
    restoreGalleryViewport(viewport);
    return;
  }
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
  if (viewMode === "waterfall") reflowGalleryColumns(galleryColumnCount);
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
  image.draggable = false;
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
  if (media.classList.contains("comparison-thumbnail-media")) {
    scheduleComparisonThumbnailFormulaFit();
  }
}

function scheduleComparisonThumbnailFormulaFit(): void {
  if (comparisonFormulaFitFrame !== undefined) return;
  comparisonFormulaFitFrame = window.requestAnimationFrame(() => {
    comparisonFormulaFitFrame = undefined;
    if (disposed) return;
    const formulas = elements.galleryGrid.querySelectorAll<HTMLElement>(
      ".comparison-thumbnail .gallery-rendered-latex",
    );
    for (let index = 0; index < formulas.length; index++) {
      fitComparisonThumbnailFormula(formulas.item(index));
    }
  });
}

function fitComparisonThumbnailFormula(formula: HTMLElement): void {
  const media = formula.closest<HTMLElement>(".comparison-thumbnail-media");
  if (!media) return;
  formula.style.setProperty("--comparison-formula-scale", "1");
  const mediaStyle = getComputedStyle(media);
  const horizontalPadding =
    Number.parseFloat(mediaStyle?.paddingLeft ?? "0") +
    Number.parseFloat(mediaStyle?.paddingRight ?? "0");
  const verticalPadding =
    Number.parseFloat(mediaStyle?.paddingTop ?? "0") +
    Number.parseFloat(mediaStyle?.paddingBottom ?? "0");
  const availableWidth = Math.max(0, media.clientWidth - horizontalPadding);
  const availableHeight = Math.max(0, media.clientHeight - verticalPadding);
  const contentWidth = formula.scrollWidth;
  const contentHeight = formula.scrollHeight;
  if (
    availableWidth <= 0 ||
    availableHeight <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return;
  }
  const scale = Math.min(
    1,
    availableWidth / contentWidth,
    availableHeight / contentHeight,
  );
  formula.style.setProperty(
    "--comparison-formula-scale",
    String(Math.max(0.05, scale)),
  );
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
  closeGalleryContextMenu();
  activeDrag = undefined;
  galleryDragPointer = undefined;
  flushGalleryImageScalePersistence();
  if (galleryDragScrollFrame !== undefined) {
    window.cancelAnimationFrame(galleryDragScrollFrame);
    galleryDragScrollFrame = undefined;
  }
  if (comparisonFormulaFitFrame !== undefined) {
    window.cancelAnimationFrame(comparisonFormulaFitFrame);
    comparisonFormulaFitFrame = undefined;
  }
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

function setLocalizedControl(
  element: HTMLElement,
  messageID: string,
  fallback = "Comparison control",
): void {
  const localization = getLocalization();
  if (localization) {
    localization.setAttributes(element, `${L10N_PREFIX}${messageID}`);
    return;
  }
  element.title = fallback;
  element.setAttribute("aria-label", fallback);
  if (element instanceof HTMLInputElement) element.placeholder = fallback;
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
