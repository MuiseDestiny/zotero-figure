import type { FigureResultKind } from "../../domain/figureResults";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  type FigureSidebarFilter as DomainFigureSidebarFilter,
} from "../../domain/figureSidebar";
import {
  clampPinnedCardTransform,
  zoomPinnedCardAtPoint,
  type Size,
} from "../../domain/pinnedFigureCard";
import {
  getPdfTranslateContext,
  isPdfTranslateAvailable,
  translateWithPdfTranslate,
} from "../../platform/zotero/pdfTranslate";
import { getString } from "../../utils/locale";
import type { PdfReader } from "../../platform/zotero/reader";
import { createDocumentBlobURL } from "../../platform/zotero/browserGlobals";
import type {
  FigureResultTranslationUpdate,
  StoredFigureResult,
} from "../../services/results/figureResultStore";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PANEL_ID = "zoterofigure-sidebar-panel";
const TAB_ID = "zoterofigure-sidebar-tab";
const STYLE_ID = "zoterofigure-sidebar-style";
const IMAGE_LOAD_CONCURRENCY = 3;
const IMAGE_PRELOAD_VIEWPORTS = 1;
const FILTER_POPOVER_ID = "zoterofigure-filter-results";
const FILTER_POPOVER_CLOSE_DELAY_MS = 140;
const IMAGE_SINGLE_CLICK_DELAY_MS = 220;
const PINNED_CARD_MARGIN = 12;
const PINNED_CARD_MAX_SCALE = 3;
const PINNED_CARD_MIN_SCALE = 0.35;
const PINNED_CARD_MAX_WIDTH = 420;
const PINNED_CARD_MIN_WIDTH = 240;
const PINNED_CARD_Z_INDEX_BASE = 2_147_483_000;

export type FigureSidebarFilter = DomainFigureSidebarFilter;

interface FigureSidebarPanelOptions {
  getCachedTranslations(
    contextKey: string,
  ): Promise<ReadonlyMap<string, string>>;
  getResults(): Promise<readonly StoredFigureResult[]>;
  isAnalyzing(): boolean;
  onAddAllToNote(): Promise<void>;
  onAddToNote(result: StoredFigureResult): Promise<void>;
  onAnalyze(): void | Promise<void>;
  onCancelAnalysis(): void;
  onCacheTranslations(
    contextKey: string,
    updates: readonly FigureResultTranslationUpdate[],
  ): Promise<ReadonlyMap<string, string>>;
  onClear(): Promise<void>;
  onCopyImage(result: StoredFigureResult): Promise<void>;
  onGoToPage(result: StoredFigureResult): Promise<void>;
  onRemove(result: StoredFigureResult): Promise<void>;
  onSaveImage(result: StoredFigureResult): Promise<void>;
  onSyncAnnotations(): Promise<void>;
  ownerWindow: Window;
  reader: PdfReader;
}

type MenuPopup = XUL.MenuPopup & {
  openPopup(
    anchor: Element,
    position: string,
    x: number,
    y: number,
    isContextMenu: boolean,
    attributesOverride: boolean,
  ): void;
};

type NativeSidebarView = "annotations" | "outline" | "thumbnails";

export interface AsyncTaskHandle {
  cancel(): boolean;
  readonly promise: Promise<void>;
  readonly started: boolean;
}

interface QueuedAsyncTask {
  cancelled: boolean;
  reject(error: unknown): void;
  resolve(): void;
  run(): Promise<void>;
  started: boolean;
}

export class BoundedAsyncTaskQueue {
  private activeTasks = 0;
  private readonly queuedTasks: QueuedAsyncTask[] = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Task queue concurrency must be a positive integer");
    }
  }

  public get activeCount(): number {
    return this.activeTasks;
  }

  public get pendingCount(): number {
    return this.queuedTasks.length;
  }

  public enqueue(run: () => void | Promise<void>): AsyncTaskHandle {
    let task!: QueuedAsyncTask;
    const promise = new Promise<void>((resolve, reject) => {
      task = {
        cancelled: false,
        reject,
        resolve,
        run: async () => run(),
        started: false,
      };
    });
    this.queuedTasks.push(task);
    this.dispatch();
    return {
      cancel: () => this.cancel(task),
      promise,
      get started() {
        return task.started;
      },
    };
  }

  public cancelPending(): number {
    let cancelled = 0;
    for (const task of [...this.queuedTasks]) {
      if (this.cancel(task)) cancelled++;
    }
    return cancelled;
  }

  private cancel(task: QueuedAsyncTask): boolean {
    if (task.started || task.cancelled) return false;
    const index = this.queuedTasks.indexOf(task);
    if (index < 0) return false;
    this.queuedTasks.splice(index, 1);
    task.cancelled = true;
    task.resolve();
    return true;
  }

  private dispatch(): void {
    while (this.activeTasks < this.concurrency && this.queuedTasks.length > 0) {
      const task = this.queuedTasks.shift() as QueuedAsyncTask;
      if (task.cancelled) continue;
      task.started = true;
      this.activeTasks++;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeTasks--;
          this.dispatch();
        });
    }
  }
}

export interface VerticalBounds {
  bottom: number;
  top: number;
}

export function isNearVerticalViewport(
  element: VerticalBounds,
  viewport: VerticalBounds,
  preloadDistance: number,
): boolean {
  const distance = Math.max(0, preloadDistance);
  return (
    element.bottom >= viewport.top - distance &&
    element.top <= viewport.bottom + distance
  );
}

type ImageLoadState = "failed" | "loaded" | "loading" | "pending" | "queued";

interface SidebarImageEntry {
  container: HTMLDivElement;
  document: Document;
  generation: number;
  image: HTMLImageElement;
  result: StoredFigureResult;
  state: ImageLoadState;
  task?: AsyncTaskHandle;
}

interface PinnedFigureCard {
  dispose(): void;
  element: HTMLElement;
}

export class FigureSidebarPanel {
  private active = false;
  private readonly blobURLReleasers = new Set<() => void>();
  private document?: Document;
  private filter: FigureSidebarFilter = "all";
  private filterPopover?: HTMLDivElement;
  private filterPopoverAnchor?: HTMLButtonElement;
  private filterPopoverCloseTimerID?: number;
  private menu?: MenuPopup;
  private mountedSidebar?: Element;
  private panel?: HTMLDivElement;
  private panelContent?: HTMLDivElement;
  private previousSidebarView: NativeSidebarView = "annotations";
  private pdfTranslateAvailable?: boolean;
  private results?: readonly StoredFigureResult[];
  private loadingResults = false;
  private reloadAfterLoad = false;
  private remountTimerID?: number;
  private renderRevision = 0;
  private imageGeneration = 0;
  private readonly imageLoadQueue = new BoundedAsyncTaskQueue(
    IMAGE_LOAD_CONCURRENCY,
  );
  private readonly imageEntries = new Set<SidebarImageEntry>();
  private imageVisibilityTimerID?: number;
  private readonly resultCards = new Map<string, HTMLElement>();
  private resultScrollTimerID?: number;
  private imageNavigationTimerID?: number;
  private readonly pendingPinnedCardIDs = new Set<string>();
  private readonly pinnedCards = new Map<string, PinnedFigureCard>();
  private pinnedCardZIndex = PINNED_CARD_Z_INDEX_BASE;
  private scrollContainer?: HTMLElement;
  private tab?: HTMLButtonElement;
  private tablist?: HTMLElement;
  private expandedComments = new Set<string>();
  private translatedComments = new Map<string, string>();
  private translationEnabled = false;
  private translationError = false;
  private translationPending = false;
  private translationRequestID = 0;
  private disposed = false;

  private readonly handleSidebarScroll = (): void => {
    this.closeFilterPopover();
    this.scheduleImageVisibilityScan();
  };

  private readonly handleTabClick = (event: MouseEvent): void => {
    const target = (event.target as Element | null)?.closest("button");
    if (!target || !this.tablist?.contains(target)) return;
    if (target === this.tab) {
      this.openPanelFromTab(event);
      return;
    }
    if (target.matches("#viewThumbnail, #viewAnnotations, #viewOutline")) {
      this.active = false;
      this.reconcile();
    }
  };

  private readonly handleOwnTabClick = (event: MouseEvent): void => {
    this.openPanelFromTab(event);
  };

  private openPanelFromTab(event: MouseEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
    this.active = true;
    try {
      this.setInternalSidebarView("zoterofigure");
    } catch (error) {
      // Zotero may reject unknown private sidebar view names. The injected
      // wrapper can still be shown directly when that happens.
      Zotero.logError(toError(error));
    }
    this.reconcile();
  }

  constructor(private readonly options: FigureSidebarPanelOptions) {}

  public attach(document: Document): void {
    if (this.disposed) return;
    if (this.document && this.document !== document) {
      this.detachDocument();
    }
    this.document = document;
    this.ensureStyle(document);
    if (!document.querySelector<HTMLElement>("#reader-ui")) return;
    this.mountedSidebar = undefined;
    this.pdfTranslateAvailable = undefined;
    this.scheduleSidebarProbe(true);
    this.reconcile();
  }

  public refresh(): void {
    this.reloadResults();
  }

  public refreshControls(): void {
    if (this.disposed) return;
    const document = this.document;
    const panelContent = this.panelContent;
    if (!document || !panelContent) return;
    this.closeFilterPopover();
    const controls = this.createControls(document, this.results ?? []);
    const current = panelContent.querySelector<HTMLElement>(
      ".zoterofigure-sidebar-controls",
    );
    if (current?.parentElement === panelContent) current.replaceWith(controls);
    else panelContent.prepend(controls);
  }

  public reloadResults(): void {
    if (this.disposed || !this.panelContent) return;
    this.requestResults(this.panelContent, true);
  }

  public dispose(): void {
    this.disposed = true;
    this.translationRequestID++;
    this.expandedComments.clear();
    this.translatedComments.clear();
    if (this.active) this.setInternalSidebarView(this.previousSidebarView);
    this.active = false;
    this.detachDocument();
  }

  private detachDocument(): void {
    this.renderRevision++;
    this.closeFilterPopover();
    this.cancelResultScroll();
    this.cancelImageNavigation();
    this.disposePinnedCards();
    this.resetImageLoads();
    this.translationRequestID++;
    this.translationPending = false;
    this.translationEnabled = false;
    this.translationError = false;
    this.loadingResults = false;
    this.reloadAfterLoad = false;
    this.expandedComments.clear();
    this.translatedComments.clear();
    this.resultCards.clear();
    this.menu?.remove();
    this.menu = undefined;
    if (this.remountTimerID !== undefined) {
      this.options.ownerWindow.clearTimeout(this.remountTimerID);
      this.remountTimerID = undefined;
    }
    this.scrollContainer?.removeEventListener(
      "scroll",
      this.handleSidebarScroll,
    );
    this.scrollContainer = undefined;
    this.mountedSidebar = undefined;
    this.pdfTranslateAvailable = undefined;
    this.tablist?.removeEventListener("click", this.handleTabClick, true);
    const content =
      this.panel?.parentElement ??
      this.document?.querySelector<HTMLElement>("#sidebarContent");
    if (content) {
      for (const child of Array.from(content.children)) {
        const element = child as HTMLElement;
        if (
          element !== this.panel &&
          element.classList.contains("viewWrapper") &&
          element.style.display === "none"
        ) {
          element.style.display = "";
        }
      }
    }
    this.tab?.remove();
    this.panel?.remove();
    this.document?.getElementById(STYLE_ID)?.remove();
    this.tab = undefined;
    this.panel = undefined;
    this.panelContent = undefined;
    this.tablist = undefined;
    this.document = undefined;
  }

  private reconcile(): void {
    if (this.disposed || !this.document) return;
    const tablist = this.document.querySelector<HTMLElement>(
      "#sidebarContainer .sidebar-toolbar .start[role='tablist']",
    );
    const content = this.document.querySelector<HTMLElement>("#sidebarContent");
    if (!tablist || !content) return;

    if (this.scrollContainer !== content) {
      this.scrollContainer?.removeEventListener(
        "scroll",
        this.handleSidebarScroll,
      );
      this.scrollContainer = content;
      this.scrollContainer.addEventListener(
        "scroll",
        this.handleSidebarScroll,
        { passive: true },
      );
    }

    if (this.tablist !== tablist) {
      this.tablist?.removeEventListener("click", this.handleTabClick, true);
      this.tablist = tablist;
      this.tablist.addEventListener("click", this.handleTabClick, true);
    }

    if (!this.tab || !this.tab.isConnected) {
      this.tab = this.createTab(this.document);
      this.tab.addEventListener("click", this.handleOwnTabClick, true);
    }
    if (!this.tablist.contains(this.tab)) {
      const outline = this.tablist.querySelector("#viewOutline");
      if (outline?.nextSibling)
        this.tablist.insertBefore(this.tab, outline.nextSibling);
      else this.tablist.append(this.tab);
    }

    let createdPanel = false;
    if (!this.panel || !this.panel.isConnected) {
      createdPanel = true;
      this.panel = this.document.createElement("div");
      this.panel.id = PANEL_ID;
      this.panel.className = "viewWrapper zoterofigure-panel-wrapper";
      this.panel.setAttribute("role", "tabpanel");
      this.panel.setAttribute("data-tabstop", "1");
      this.panel.setAttribute("aria-labelledby", TAB_ID);
      this.panelContent = this.document.createElement("div");
      this.panelContent.className = "zoterofigure-sidebar-panel";
      this.panel.append(this.panelContent);
    }
    if (!content.contains(this.panel)) content.append(this.panel);

    if (createdPanel || !this.panelContent?.hasChildNodes()) this.render();
    this.applyVisibility(content);
  }

  private render(): void {
    const document = this.document;
    const panelContent = this.panelContent;
    if (!document || !panelContent) return;
    if (this.results !== undefined) {
      this.renderContent(panelContent, this.results);
      return;
    }

    this.closeFilterPopover();
    this.resultCards.clear();
    this.resetImageLoads();
    const loading = document.createElement("div");
    loading.className = "zoterofigure-sidebar-list";
    loading.append(this.createLoading(document));
    panelContent.replaceChildren(this.createControls(document, []), loading);
    this.requestResults(panelContent);
  }

  private requestResults(panelContent: HTMLDivElement, force = false): void {
    if (this.loadingResults) {
      if (force) this.reloadAfterLoad = true;
      return;
    }
    this.loadingResults = true;
    const revision = ++this.renderRevision;
    void this.loadResults(revision, panelContent);
  }

  private async loadResults(
    revision: number,
    panelContent: HTMLDivElement,
  ): Promise<void> {
    try {
      const results = await this.options.getResults();
      if (this.disposed || revision !== this.renderRevision) return;
      this.results = results;
      this.renderContent(panelContent, results);
    } catch (error) {
      if (this.disposed || revision !== this.renderRevision) return;
      const document = this.document;
      if (!document) return;
      const message = document.createElement("div");
      message.className =
        "zoterofigure-sidebar-empty zoterofigure-sidebar-error";
      message.textContent = `${getString("sidebar-load-error")}: ${toError(error).message}`;
      if (this.results !== undefined) {
        this.renderContent(panelContent, this.results);
      } else {
        panelContent.replaceChildren(
          this.createControls(document, []),
          message,
        );
      }
    } finally {
      if (revision === this.renderRevision) {
        this.loadingResults = false;
        if (this.reloadAfterLoad) {
          this.reloadAfterLoad = false;
          this.requestResults(panelContent, true);
        }
      }
    }
  }

  private renderContent(
    panelContent: HTMLDivElement,
    results: readonly StoredFigureResult[],
  ): void {
    const document = this.document;
    if (!document) return;
    this.closeFilterPopover();
    this.resultCards.clear();
    this.resetImageLoads();
    const filtered = filterAndSortFigureSidebarItems(
      results,
      this.filter,
      (result) => result,
    );
    const list = document.createElement("div");
    list.className = "zoterofigure-sidebar-list";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "zoterofigure-sidebar-empty";
      empty.textContent = getString("sidebar-empty");
      list.append(empty);
    } else {
      for (const result of filtered) list.append(this.createCard(result));
    }
    const children: HTMLElement[] = [this.createControls(document, results)];
    if (this.translationError) {
      const status = document.createElement("div");
      status.className = "zoterofigure-sidebar-status";
      status.textContent = getString("sidebar-translation-error");
      children.push(status);
    }
    children.push(list);
    panelContent.replaceChildren(...children);
    this.scheduleImageVisibilityScan();
  }

  private createControls(
    document: Document,
    results: readonly StoredFigureResult[],
  ): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className = "zoterofigure-sidebar-controls";
    controls.append(this.createActions(document, results));
    if (results.length > 0) {
      controls.append(this.createFilters(document, results));
    }
    return controls;
  }

  private createLoading(document: Document): HTMLElement {
    const loading = document.createElement("div");
    loading.className = "zoterofigure-sidebar-empty";
    loading.textContent = getString("sidebar-loading");
    return loading;
  }

  private createActions(
    document: Document,
    results: readonly StoredFigureResult[],
  ): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "zoterofigure-sidebar-actions";
    const analyzing = this.options.isAnalyzing();
    const translationAvailable =
      this.pdfTranslateAvailable ??
      (this.pdfTranslateAvailable = isPdfTranslateAvailable());
    actions.append(
      this.createAnalysisButton(document, analyzing),
      ...(translationAvailable
        ? [
            this.createActionButton(
              document,
              this.translationEnabled
                ? "sidebar-show-original"
                : "sidebar-translate",
              "languages",
              () => this.toggleTranslation(results),
              this.translationPending ||
                !results.some((result) => result.comment.trim()),
            ),
          ]
        : []),
      this.createActionButton(
        document,
        "sidebar-sync-annotations",
        "annotation",
        () => this.options.onSyncAnnotations(),
        results.length === 0 || analyzing,
      ),
      this.createActionButton(
        document,
        "sidebar-add-all-to-note",
        "note",
        () => this.options.onAddAllToNote(),
        results.length === 0 || analyzing,
      ),
      this.createActionButton(document, "sidebar-refresh", "refresh", () =>
        this.refresh(),
      ),
      this.createActionButton(
        document,
        "sidebar-clear",
        "trash",
        () => this.clearLocalResults(),
        results.length === 0 || analyzing,
      ),
    );
    return actions;
  }

  private async clearLocalResults(): Promise<void> {
    this.renderRevision++;
    this.loadingResults = false;
    this.reloadAfterLoad = false;
    this.results = [];
    this.translationRequestID++;
    this.translatedComments.clear();
    this.translationEnabled = false;
    this.translationError = false;
    this.translationPending = false;
    this.render();
    await new Promise<void>((resolve) =>
      this.options.ownerWindow.setTimeout(resolve, 0),
    );
    try {
      await this.options.onClear();
    } catch (error) {
      this.results = undefined;
      this.render();
      throw error;
    }
  }

  private createAnalysisButton(
    document: Document,
    analyzing: boolean,
  ): HTMLButtonElement {
    const button = this.createActionButton(
      document,
      analyzing ? "sidebar-cancel" : "sidebar-analyze",
      "plugin",
      analyzing ? this.options.onCancelAnalysis : this.options.onAnalyze,
    );
    button.classList.add("zoterofigure-analysis-action");
    if (analyzing) {
      button.setAttribute("aria-busy", "true");
      const magnifier = createSvgIcon(document, "search");
      magnifier.classList.add("zoterofigure-analysis-magnifier");
      button.append(magnifier);
    }
    return button;
  }

  private createActionButton(
    document: Document,
    labelKey: string,
    iconKind:
      | "annotation"
      | "languages"
      | "note"
      | "plugin"
      | "refresh"
      | "trash",
    action: () => void | Promise<void>,
    disabled = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoterofigure-sidebar-action";
    button.title = getString(labelKey);
    button.setAttribute("aria-label", getString(labelKey));
    button.disabled = disabled;
    button.append(
      iconKind === "note"
        ? createNativeNoteIcon(document)
        : iconKind === "plugin"
          ? createPluginIcon(document, "zoterofigure-analysis-plugin-icon")
          : createSvgIcon(document, iconKind),
    );
    button.addEventListener("click", () => {
      void Promise.resolve(action()).catch((error) =>
        Zotero.logError(toError(error)),
      );
    });
    return button;
  }

  private createFilters(
    document: Document,
    results: readonly StoredFigureResult[],
  ): HTMLElement {
    const filters = document.createElement("div");
    filters.className = "zoterofigure-sidebar-filters";
    const counts = countFigureSidebarItems(results, (result) => result);
    for (const filter of ["all", "figure", "table"] as const) {
      const filterResults = filterAndSortFigureSidebarItems(
        results,
        filter,
        (result) => result,
      );
      const slot = document.createElement("div");
      slot.className = "zoterofigure-sidebar-filter-slot";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zoterofigure-sidebar-filter";
      button.dataset.filter = filter;
      button.classList.toggle("selected", filter === this.filter);
      button.setAttribute("aria-pressed", String(filter === this.filter));
      button.textContent = getString(`sidebar-filter-${filter}`, {
        args: { count: counts[filter] },
      });
      button.addEventListener("click", () => {
        this.closeFilterPopover();
        if (this.filter === filter) return;
        this.filter = filter;
        this.render();
      });
      if (filterResults.length > 0) {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-haspopup", "menu");
        button.addEventListener("mouseenter", () =>
          this.openFilterPopover(
            document,
            slot,
            button,
            filter,
            filterResults,
          ),
        );
        button.addEventListener("mouseleave", () =>
          this.scheduleFilterPopoverClose(),
        );
        button.addEventListener("focus", () =>
          this.openFilterPopover(
            document,
            slot,
            button,
            filter,
            filterResults,
          ),
        );
        button.addEventListener("blur", (event) => {
          const next = event.relatedTarget as Node | null;
          if (next && this.filterPopover?.contains(next)) return;
          this.scheduleFilterPopoverClose();
        });
        button.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          this.openFilterPopover(
            document,
            slot,
            button,
            filter,
            filterResults,
            event.key === "ArrowDown" ? "first" : "last",
          );
        });
      }
      slot.append(button);
      filters.append(slot);
    }
    return filters;
  }

  private openFilterPopover(
    document: Document,
    host: HTMLElement,
    anchor: HTMLButtonElement,
    filter: FigureSidebarFilter,
    results: readonly StoredFigureResult[],
    focusItem?: "first" | "last",
  ): void {
    this.cancelFilterPopoverClose();
    if (
      this.filterPopoverAnchor === anchor &&
      this.filterPopover?.isConnected
    ) {
      if (focusItem) this.focusFilterPopoverItem(focusItem);
      return;
    }

    this.closeFilterPopover();
    const popover = document.createElement("div");
    popover.id = FILTER_POPOVER_ID;
    popover.className = "zoterofigure-filter-results";
    popover.setAttribute("aria-label", anchor.textContent?.trim() ?? "");
    popover.setAttribute("role", "menu");

    for (const result of results) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "zoterofigure-filter-result";
      item.dataset.resultId = result.id;
      item.setAttribute("role", "menuitem");
      const label = getFigureSidebarNavigationLabel({
        comment: this.getDisplayComment(result),
        tag: result.tag,
      });
      item.setAttribute("aria-label", label);
      item.title = label;
      const text = document.createElement("span");
      text.className = "zoterofigure-filter-result-label";
      text.textContent = label;
      item.append(text);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectFilterResult(filter, result.id);
      });
      popover.append(item);
    }

    popover.addEventListener("mouseenter", () =>
      this.cancelFilterPopoverClose(),
    );
    popover.addEventListener("mouseleave", () =>
      this.scheduleFilterPopoverClose(),
    );
    popover.addEventListener("focusin", () => this.cancelFilterPopoverClose());
    popover.addEventListener("focusout", (event) => {
      const next = event.relatedTarget as Node | null;
      if (next && (next === anchor || popover.contains(next))) return;
      this.scheduleFilterPopoverClose();
    });
    popover.addEventListener("keydown", (event) =>
      this.handleFilterPopoverKeydown(event, anchor),
    );

    this.filterPopover = popover;
    this.filterPopoverAnchor = anchor;
    anchor.setAttribute("aria-controls", FILTER_POPOVER_ID);
    anchor.setAttribute("aria-expanded", "true");
    host.append(popover);
    if (focusItem) this.focusFilterPopoverItem(focusItem);
  }

  private handleFilterPopoverKeydown(
    event: KeyboardEvent,
    anchor: HTMLButtonElement,
  ): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeFilterPopover();
      anchor.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = this.getFilterPopoverItems();
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(event.target as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex].focus();
  }

  private focusFilterPopoverItem(position: "first" | "last"): void {
    const items = this.getFilterPopoverItems();
    items[position === "first" ? 0 : items.length - 1]?.focus();
  }

  private getFilterPopoverItems(): HTMLButtonElement[] {
    const items: HTMLButtonElement[] = [];
    const children = this.filterPopover?.children;
    if (!children) return items;
    for (let index = 0; index < children.length; index++) {
      const child = children.item(index);
      if (child) items.push(child as HTMLButtonElement);
    }
    return items;
  }

  private scheduleFilterPopoverClose(): void {
    this.cancelFilterPopoverClose();
    this.filterPopoverCloseTimerID = this.options.ownerWindow.setTimeout(() => {
      this.filterPopoverCloseTimerID = undefined;
      this.closeFilterPopover();
    }, FILTER_POPOVER_CLOSE_DELAY_MS);
  }

  private cancelFilterPopoverClose(): void {
    if (this.filterPopoverCloseTimerID === undefined) return;
    this.options.ownerWindow.clearTimeout(this.filterPopoverCloseTimerID);
    this.filterPopoverCloseTimerID = undefined;
  }

  private closeFilterPopover(): void {
    this.cancelFilterPopoverClose();
    this.filterPopoverAnchor?.setAttribute("aria-expanded", "false");
    this.filterPopoverAnchor?.removeAttribute("aria-controls");
    this.filterPopover?.remove();
    this.filterPopover = undefined;
    this.filterPopoverAnchor = undefined;
  }

  private selectFilterResult(
    filter: FigureSidebarFilter,
    resultID: string,
  ): void {
    this.closeFilterPopover();
    const filterChanged = this.filter !== filter;
    this.filter = filter;
    if (filterChanged) this.render();
    this.scheduleResultScroll(resultID);
  }

  private scheduleResultScroll(resultID: string): void {
    this.cancelResultScroll();
    this.resultScrollTimerID = this.options.ownerWindow.setTimeout(() => {
      this.resultScrollTimerID = undefined;
      if (this.disposed) return;
      const card = this.resultCards.get(resultID);
      const viewport = this.scrollContainer;
      if (!card?.isConnected || !viewport?.isConnected) return;
      const viewportBounds = viewport.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const controlsHeight =
        this.panelContent
          ?.querySelector<HTMLElement>(".zoterofigure-sidebar-controls")
          ?.getBoundingClientRect().height ?? 0;
      const top =
        viewport.scrollTop +
        cardBounds.top -
        viewportBounds.top -
        controlsHeight -
        6;
      viewport.scrollTo({ behavior: "smooth", top: Math.max(0, top) });
      card.focus({ preventScroll: true });
    }, 0);
  }

  private cancelResultScroll(): void {
    if (this.resultScrollTimerID === undefined) return;
    this.options.ownerWindow.clearTimeout(this.resultScrollTimerID);
    this.resultScrollTimerID = undefined;
  }

  private async toggleTranslation(
    results: readonly StoredFigureResult[],
  ): Promise<void> {
    if (this.translationPending) return;
    if (this.translationEnabled) {
      this.translationRequestID++;
      this.translationEnabled = false;
      this.translationError = false;
      this.translatedComments.clear();
      this.render();
      return;
    }

    const translatable = results.filter((result) => result.comment.trim());
    if (translatable.length === 0) return;
    const requestID = ++this.translationRequestID;
    this.translationPending = true;
    this.translationError = false;
    this.render();
    try {
      const context = getPdfTranslateContext();
      const translatedComments = new Map<string, string>();
      try {
        const cached = await this.options.getCachedTranslations(
          context.cacheKey,
        );
        for (const result of translatable) {
          const text = cached.get(result.id)?.trim();
          if (text) translatedComments.set(result.id, text);
        }
      } catch (error) {
        Zotero.logError(toError(error));
      }
      if (this.disposed || requestID !== this.translationRequestID) return;

      const missing = translatable.filter(
        (result) => !translatedComments.has(result.id),
      );
      const translated = await Promise.allSettled(
        missing.map(async (result) => {
          const response = await translateWithPdfTranslate(
            result.comment,
            Zotero,
            context,
          );
          const text = response.available ? response.text?.trim() : undefined;
          return text
            ? ({ id: result.id, source: result.comment, text } as const)
            : undefined;
        }),
      );
      if (this.disposed || requestID !== this.translationRequestID) return;
      const translatedEntries: FigureResultTranslationUpdate[] = translated
        .filter(
          (
            entry,
          ): entry is PromiseFulfilledResult<FigureResultTranslationUpdate> =>
            entry.status === "fulfilled" && entry.value !== undefined,
        )
        .map((entry) => entry.value);
      for (const entry of translatedEntries) {
        translatedComments.set(entry.id, entry.text);
      }
      if (translatedEntries.length) {
        try {
          await this.options.onCacheTranslations(
            context.cacheKey,
            translatedEntries,
          );
        } catch (error) {
          Zotero.logError(toError(error));
        }
      }
      if (this.disposed || requestID !== this.translationRequestID) return;
      this.translatedComments = translatedComments;
      this.translationEnabled = this.translatedComments.size > 0;
      this.translationError =
        translated.some((entry) => entry.status === "rejected") ||
        this.translatedComments.size !== translatable.length;
    } finally {
      if (requestID === this.translationRequestID) {
        this.translationPending = false;
        this.render();
      }
    }
  }

  private createCard(result: StoredFigureResult): HTMLElement {
    const document = this.document;
    if (!document) throw new Error("Figure sidebar document is unavailable");
    const card = document.createElement("article");
    card.className = "zoterofigure-sidebar-card";
    card.dataset.resultId = result.id;
    card.tabIndex = -1;
    card.setAttribute(
      "aria-label",
      getFigureSidebarNavigationLabel({
        comment: this.getDisplayComment(result),
        tag: result.tag,
      }),
    );

    const header = document.createElement("header");
    const start = document.createElement("div");
    start.className = "zoterofigure-card-start";
    start.append(createSvgIcon(document, result.kind));
    const page = document.createElement("span");
    page.className = "zoterofigure-card-page";
    page.textContent = getString("sidebar-page", {
      args: { page: result.pageLabel },
    });
    start.append(page);
    const end = document.createElement("div");
    end.className = "zoterofigure-card-end";
    end.append(this.createMenuButton(document, result));
    header.append(start, end);
    header.addEventListener("click", () => this.goToPage(result));

    const image = document.createElement("div");
    image.className = "zoterofigure-card-image";
    const cropWidth = result.rect[2] - result.rect[0];
    const cropHeight = result.rect[3] - result.rect[1];
    if (cropWidth > 0 && cropHeight > 0) {
      image.style.aspectRatio = `${cropWidth} / ${cropHeight}`;
    }
    const imageElement = document.createElement("img");
    imageElement.alt = this.getDisplayComment(result);
    imageElement.decoding = "async";
    image.append(this.createImagePlaceholder(document));
    this.imageEntries.add({
      container: image,
      document,
      generation: this.imageGeneration,
      image: imageElement,
      result,
      state: "pending",
    });
    image.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      this.scheduleImageNavigation(result);
    });
    image.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancelImageNavigation();
      void this.pinCard(result, card).catch((error) =>
        Zotero.logError(toError(error)),
      );
    });

    const comment = this.createComment(document, result);
    card.append(header, image, comment);
    this.resultCards.set(result.id, card);
    return card;
  }

  private scheduleImageNavigation(result: StoredFigureResult): void {
    this.cancelImageNavigation();
    this.imageNavigationTimerID = this.options.ownerWindow.setTimeout(() => {
      this.imageNavigationTimerID = undefined;
      void this.goToPage(result).catch((error) =>
        Zotero.logError(toError(error)),
      );
    }, IMAGE_SINGLE_CLICK_DELAY_MS);
  }

  private cancelImageNavigation(): void {
    if (this.imageNavigationTimerID === undefined) return;
    this.options.ownerWindow.clearTimeout(this.imageNavigationTimerID);
    this.imageNavigationTimerID = undefined;
  }

  private async pinCard(
    result: StoredFigureResult,
    sourceCard: HTMLElement,
  ): Promise<void> {
    const existing = this.pinnedCards.get(result.id);
    if (existing) {
      this.bringPinnedCardToFront(existing.element);
      return;
    }
    if (this.pendingPinnedCardIDs.has(result.id)) return;
    const document = this.document;
    if (!document) return;

    this.pendingPinnedCardIDs.add(result.id);
    try {
      const bytes = await IOUtils.read(result.imagePath);
      if (this.disposed || this.document !== document) return;
      const blobURL = createDocumentBlobURL(document, [bytes], {
        type: "image/png",
      });
      if (this.disposed || this.document !== document) {
        blobURL.release();
        return;
      }

      const element = sourceCard.cloneNode(true) as HTMLElement;
      const image = element.querySelector<HTMLImageElement>(
        ".zoterofigure-card-image img",
      );
      if (!image) {
        blobURL.release();
        return;
      }
      image.src = blobURL.url;
      this.preparePinnedCardElement(element);
      document.documentElement.append(element);

      const entry = this.bindPinnedCard(result.id, element, blobURL.release);
      this.pinnedCards.set(result.id, entry);
      this.bringPinnedCardToFront(element);
      element.focus({ preventScroll: true });
    } finally {
      this.pendingPinnedCardIDs.delete(result.id);
    }
  }

  private preparePinnedCardElement(element: HTMLElement): void {
    const document = element.ownerDocument;
    const root = document.documentElement;
    const sourceWidth = element.getBoundingClientRect().width;
    const availableWidth = Math.max(
      160,
      root.clientWidth - PINNED_CARD_MARGIN * 2,
    );
    const width = Math.min(
      PINNED_CARD_MAX_WIDTH,
      availableWidth,
      Math.max(PINNED_CARD_MIN_WIDTH, sourceWidth),
    );
    element.classList.add("zoterofigure-pinned-card");
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.transform = "scale(1)";
    element.style.width = `${width}px`;
    element.tabIndex = 0;
    for (const descendant of element.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]",
    )) {
      descendant.tabIndex = -1;
    }
  }

  private bindPinnedCard(
    resultID: string,
    element: HTMLElement,
    releaseImageURL: () => void,
  ): PinnedFigureCard {
    const document = element.ownerDocument;
    const root = document.documentElement;
    const baseBounds = element.getBoundingClientRect();
    const cardSize: Size = {
      height: baseBounds.height,
      width: baseBounds.width,
    };
    const stagger = this.pinnedCards.size * 18;
    let transform = clampPinnedCardTransform(
      {
        scale: 1,
        x: root.clientWidth - cardSize.width - PINNED_CARD_MARGIN - stagger,
        y: PINNED_CARD_MARGIN + stagger,
      },
      cardSize,
      getDocumentViewportSize(document),
      PINNED_CARD_MARGIN,
    );
    let draggingPointerID: number | undefined;
    let previousPointerX = 0;
    let previousPointerY = 0;

    const applyTransform = (): void => {
      element.style.left = `${transform.x}px`;
      element.style.top = `${transform.y}px`;
      element.style.transform = `scale(${transform.scale})`;
    };
    const clampToViewport = (): void => {
      transform = clampPinnedCardTransform(
        transform,
        cardSize,
        getDocumentViewportSize(document),
        PINNED_CARD_MARGIN,
      );
      applyTransform();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      this.bringPinnedCardToFront(element);
      element.focus({ preventScroll: true });
      draggingPointerID = event.pointerId;
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
      element.classList.add("is-dragging");
      element.setPointerCapture(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== draggingPointerID) return;
      event.preventDefault();
      transform = {
        ...transform,
        x: transform.x + event.clientX - previousPointerX,
        y: transform.y + event.clientY - previousPointerY,
      };
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
      clampToViewport();
    };
    const stopDragging = (event: PointerEvent): void => {
      if (event.pointerId !== draggingPointerID) return;
      draggingPointerID = undefined;
      element.classList.remove("is-dragging");
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.bringPinnedCardToFront(element);
      const boundedDelta = Math.max(-100, Math.min(100, event.deltaY));
      const nextScale = Math.max(
        PINNED_CARD_MIN_SCALE,
        Math.min(
          PINNED_CARD_MAX_SCALE,
          transform.scale * Math.exp(-boundedDelta * 0.0025),
        ),
      );
      transform = zoomPinnedCardAtPoint(transform, nextScale, {
        x: event.clientX,
        y: event.clientY,
      });
      clampToViewport();
    };
    const handleDoubleClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.closePinnedCard(resultID);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closePinnedCard(resultID);
    };
    const view = document.defaultView;

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", stopDragging);
    element.addEventListener("pointercancel", stopDragging);
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("dblclick", handleDoubleClick);
    element.addEventListener("keydown", handleKeyDown);
    view?.addEventListener("resize", clampToViewport);
    applyTransform();

    let disposed = false;
    return {
      element,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        view?.removeEventListener("resize", clampToViewport);
        element.remove();
        releaseImageURL();
      },
    };
  }

  private bringPinnedCardToFront(element: HTMLElement): void {
    element.style.zIndex = String(this.pinnedCardZIndex++);
  }

  private closePinnedCard(resultID: string): void {
    const entry = this.pinnedCards.get(resultID);
    if (!entry) return;
    this.pinnedCards.delete(resultID);
    entry.dispose();
  }

  private disposePinnedCards(): void {
    this.pendingPinnedCardIDs.clear();
    for (const entry of this.pinnedCards.values()) entry.dispose();
    this.pinnedCards.clear();
    this.pinnedCardZIndex = PINNED_CARD_Z_INDEX_BASE;
  }

  private async loadLocalImage(entry: SidebarImageEntry): Promise<void> {
    try {
      const bytes = await IOUtils.read(entry.result.imagePath);
      if (!this.isCurrentImageEntry(entry)) return;
      const blobURL = createDocumentBlobURL(entry.document, [bytes], {
        type: "image/png",
      });
      const releaseURL = () => blobURL.release();
      if (!this.isCurrentImageEntry(entry)) {
        releaseURL();
        return;
      }
      this.blobURLReleasers.add(releaseURL);
      entry.image.addEventListener(
        "error",
        () => {
          if (!this.isCurrentImageEntry(entry)) return;
          entry.state = "failed";
          this.releaseBlobURL(releaseURL);
          entry.container.replaceChildren(
            this.createImagePlaceholder(
              entry.document,
              "sidebar-image-unavailable",
            ),
          );
        },
        { once: true },
      );
      entry.image.src = blobURL.url;
      entry.container.replaceChildren(entry.image);
      entry.state = "loaded";
    } catch (error) {
      if (!this.isCurrentImageEntry(entry)) return;
      Zotero.logError(toError(error));
      entry.state = "failed";
      entry.container.replaceChildren(
        this.createImagePlaceholder(
          entry.document,
          "sidebar-image-unavailable",
        ),
      );
    }
  }

  private isCurrentImageEntry(entry: SidebarImageEntry): boolean {
    return (
      !this.disposed &&
      entry.generation === this.imageGeneration &&
      this.imageEntries.has(entry) &&
      entry.container.isConnected
    );
  }

  private scheduleImageVisibilityScan(): void {
    if (
      this.disposed ||
      !this.active ||
      this.imageVisibilityTimerID !== undefined
    ) {
      return;
    }
    this.imageVisibilityTimerID = this.options.ownerWindow.setTimeout(() => {
      this.imageVisibilityTimerID = undefined;
      this.scanImageVisibility();
    }, 0);
  }

  private scanImageVisibility(): void {
    if (this.disposed || !this.active) return;
    const viewport = this.scrollContainer;
    if (!viewport?.isConnected) return;
    const candidates = [...this.imageEntries].filter(
      (entry) => entry.state === "pending" && this.isCurrentImageEntry(entry),
    );
    if (candidates.length === 0) return;

    const bounds = viewport.getBoundingClientRect();
    const viewportHeight = Math.max(0, bounds.bottom - bounds.top);
    if (viewportHeight === 0) {
      for (const entry of candidates.slice(0, IMAGE_LOAD_CONCURRENCY)) {
        this.queueImageLoad(entry);
      }
      return;
    }

    const preloadDistance = viewportHeight * IMAGE_PRELOAD_VIEWPORTS;
    for (const entry of candidates) {
      if (
        isNearVerticalViewport(
          entry.container.getBoundingClientRect(),
          bounds,
          preloadDistance,
        )
      ) {
        this.queueImageLoad(entry);
      }
    }
  }

  private queueImageLoad(entry: SidebarImageEntry): void {
    if (entry.state !== "pending" || !this.isCurrentImageEntry(entry)) return;
    entry.state = "queued";
    const task = this.imageLoadQueue.enqueue(async () => {
      if (!this.isCurrentImageEntry(entry)) return;
      entry.state = "loading";
      await this.loadLocalImage(entry);
    });
    entry.task = task;
    void task.promise.then(
      () => this.finishImageLoad(entry, task),
      (error) => {
        Zotero.logError(toError(error));
        this.finishImageLoad(entry, task);
      },
    );
  }

  private finishImageLoad(
    entry: SidebarImageEntry,
    task: AsyncTaskHandle,
  ): void {
    if (entry.task !== task) return;
    entry.task = undefined;
    if (entry.state === "queued") entry.state = "pending";
    this.scheduleImageVisibilityScan();
  }

  private cancelQueuedImageLoads(): void {
    for (const entry of this.imageEntries) {
      if (entry.state !== "queued" || !entry.task?.cancel()) continue;
      entry.task = undefined;
      entry.state = "pending";
    }
  }

  private resetImageLoads(): void {
    this.imageGeneration++;
    if (this.imageVisibilityTimerID !== undefined) {
      this.options.ownerWindow.clearTimeout(this.imageVisibilityTimerID);
      this.imageVisibilityTimerID = undefined;
    }
    this.imageLoadQueue.cancelPending();
    this.imageEntries.clear();
    for (const release of [...this.blobURLReleasers]) {
      this.releaseBlobURL(release);
    }
  }

  private releaseBlobURL(release: () => void): void {
    if (!this.blobURLReleasers.delete(release)) return;
    try {
      release();
    } catch (error) {
      Zotero.logError(toError(error));
    }
  }

  private createImagePlaceholder(
    document: Document,
    labelKey = "sidebar-image-preparing",
  ): HTMLSpanElement {
    const placeholder = document.createElement("span");
    placeholder.className = "zoterofigure-card-image-placeholder";
    placeholder.textContent = getString(labelKey);
    return placeholder;
  }

  private createComment(
    document: Document,
    result: StoredFigureResult,
  ): HTMLElement {
    const text = this.getDisplayComment(result).trim();
    if (!text) {
      const empty = document.createElement("div");
      empty.className = "zoterofigure-card-comment is-empty";
      empty.textContent = getString("sidebar-no-caption");
      return empty;
    }

    const expanded = this.expandedComments.has(result.id);
    const comment = document.createElement("button");
    comment.type = "button";
    comment.className = "zoterofigure-card-comment";
    comment.classList.toggle("expanded", expanded);
    comment.setAttribute("aria-expanded", String(expanded));
    comment.setAttribute(
      "aria-label",
      getString(
        expanded ? "sidebar-collapse-caption" : "sidebar-expand-caption",
      ),
    );
    const textNode = document.createElement("span");
    textNode.className = "zoterofigure-card-comment-text";
    textNode.textContent = text;
    comment.append(textNode);
    comment.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextExpanded = !this.expandedComments.has(result.id);
      if (nextExpanded) this.expandedComments.add(result.id);
      else this.expandedComments.delete(result.id);
      comment.classList.toggle("expanded", nextExpanded);
      comment.setAttribute("aria-expanded", String(nextExpanded));
      comment.setAttribute(
        "aria-label",
        getString(
          nextExpanded ? "sidebar-collapse-caption" : "sidebar-expand-caption",
        ),
      );
    });
    return comment;
  }

  private createMenuButton(
    document: Document,
    result: StoredFigureResult,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoterofigure-card-menu";
    button.title = getString("sidebar-menu");
    button.setAttribute("aria-label", getString("sidebar-menu"));
    button.append(createSvgIcon(document, "menu"));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openMenu(button, result);
    });
    return button;
  }

  private openMenu(
    anchor: HTMLButtonElement,
    result: StoredFigureResult,
  ): void {
    this.menu?.remove();
    const menu = this.options.ownerWindow.document.createXULElement(
      "menupopup",
    ) as MenuPopup;
    menu.id = `${PANEL_ID}-menu`;
    this.appendMenuItem(menu, "sidebar-copy-image", () =>
      this.options.onCopyImage(result),
    );
    this.appendMenuItem(menu, "sidebar-save-image", () =>
      this.options.onSaveImage(result),
    );
    this.appendMenuItem(menu, "sidebar-go-to-page", () =>
      this.options.onGoToPage(result),
    );
    menu.append(
      this.options.ownerWindow.document.createXULElement("menuseparator"),
    );
    this.appendMenuItem(menu, "sidebar-add-to-note", () =>
      this.options.onAddToNote(result),
    );
    this.appendMenuItem(menu, "sidebar-remove", () =>
      this.options.onRemove(result),
    );
    const container =
      this.options.ownerWindow.document.querySelector("#browser") ??
      this.options.ownerWindow.document.documentElement;
    container.append(menu);
    menu.addEventListener("popuphidden", () => menu.remove(), { once: true });
    menu.openPopup(anchor, "after_start", 0, 0, false, false);
    this.menu = menu;
  }

  private appendMenuItem(
    menu: MenuPopup,
    key: string,
    command: () => void | Promise<void>,
  ): void {
    const item = this.options.ownerWindow.document.createXULElement("menuitem");
    item.setAttribute("label", getString(key));
    item.addEventListener("command", () => {
      void Promise.resolve(command()).catch((error) =>
        Zotero.logError(toError(error)),
      );
    });
    menu.append(item);
  }

  private async goToPage(result: StoredFigureResult): Promise<void> {
    await this.options.onGoToPage(result);
  }

  private getDisplayComment(result: StoredFigureResult): string {
    if (!this.translationEnabled) return result.comment;
    return this.translatedComments.get(result.id) ?? result.comment;
  }

  private applyVisibility(content: HTMLElement): void {
    if (!this.panel) return;
    for (const child of Array.from(content.children)) {
      const element = child as HTMLElement;
      if (!element.classList.contains("viewWrapper")) continue;
      element.style.display = this.active
        ? element === this.panel
          ? ""
          : "none"
        : element === this.panel
          ? "none"
          : "";
    }
    const tablist = this.tablist;
    if (!tablist) return;
    const nativeTabs = tablist.querySelectorAll<HTMLButtonElement>(
      "#viewThumbnail, #viewAnnotations, #viewOutline",
    );
    for (let index = 0; index < nativeTabs.length; index++) {
      const button = nativeTabs[index] as HTMLButtonElement;
      if (!this.active) continue;
      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
    }
    this.tab?.classList.toggle("active", this.active);
    this.tab?.setAttribute("aria-selected", String(this.active));
    if (this.active) this.scheduleImageVisibilityScan();
    else this.cancelQueuedImageLoads();
  }

  private createTab(document: Document): HTMLButtonElement {
    const button = document.createElement("button");
    button.id = TAB_ID;
    button.className = "toolbar-button zoterofigure-sidebar-tab";
    button.type = "button";
    button.tabIndex = -1;
    button.title = getString("sidebar-title");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(this.active));
    button.setAttribute("aria-controls", PANEL_ID);
    button.append(createPluginIcon(document));
    return button;
  }

  private ensureStyle(document: Document): void {
    const existing = document.getElementById(STYLE_ID);
    if (existing?.tagName === "STYLE") return;
    existing?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = Zotero.File.getContentsFromURL(
      "chrome://zoterofigure/content/figure-sidebar.css",
    );
    (document.head ?? document.documentElement).append(style);
  }

  private setInternalSidebarView(view: string): void {
    const internalReader = this.options.reader._internalReader as unknown as {
      _state?: { sidebarView?: string };
      setSidebarView?: (view: string) => void;
    };
    if (view === "zoterofigure") {
      const current = internalReader._state?.sidebarView;
      if (isNativeSidebarView(current)) this.previousSidebarView = current;
    }
    internalReader.setSidebarView?.(view);
  }

  private scheduleSidebarProbe(immediate = false): void {
    if (this.disposed || this.remountTimerID !== undefined) return;
    const probe = (): void => {
      this.remountTimerID = undefined;
      if (this.disposed || !this.document) return;
      const sidebar = this.document.querySelector<Element>("#sidebarContainer");
      const translationAvailable = isPdfTranslateAvailable();
      const translationAvailabilityChanged =
        this.pdfTranslateAvailable !== undefined &&
        this.pdfTranslateAvailable !== translationAvailable;
      this.pdfTranslateAvailable = translationAvailable;
      const needsReconcile =
        sidebar !== this.mountedSidebar ||
        (sidebar !== null &&
          (!this.tab?.isConnected || !this.panel?.isConnected));
      this.mountedSidebar = sidebar ?? undefined;
      if (needsReconcile) this.reconcile();
      else if (translationAvailabilityChanged) this.render();
      this.scheduleSidebarProbe();
    };
    this.remountTimerID = this.options.ownerWindow.setTimeout(
      probe,
      immediate ? 0 : 500,
    );
  }
}

function isNativeSidebarView(
  view: string | undefined,
): view is NativeSidebarView {
  return view === "annotations" || view === "outline" || view === "thumbnails";
}

function createSvgIcon(
  document: Document,
  kind:
    | FigureResultKind
    | "annotation"
    | "languages"
    | "menu"
    | "refresh"
    | "search"
    | "trash",
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute(
    "viewBox",
    kind === "annotation" ? "0 0 16 16" : "0 0 24 24",
  );
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("zoterofigure-svg-icon", `zoterofigure-icon-${kind}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attributes] of iconParts(kind)) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }
  return svg;
}

function createPluginIcon(
  document: Document,
  className?: string,
): HTMLImageElement {
  const icon = document.createElement("img");
  if (className) icon.classList.add(className);
  icon.src = __pluginIconDataURL__;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function createNativeNoteIcon(document: Document): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.classList.add("zoterofigure-native-note-icon");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("clip-rule", "evenodd");
  path.setAttribute(
    "d",
    "M3.625 1H3V1.625V3.75V5V18.375V19H3.625H12.375H12.6339L12.8169 18.8169L17.8169 13.8169L18 13.6339V13.375V1.625V1H17.375H3.625ZM4.25 5V17.75H11.75V13.375V12.75H12.375H16.75V5H4.25ZM16.75 3.75V2.25H4.25V3.75H16.75ZM13 14H15.8661L13 16.8661V14Z",
  );
  path.setAttribute("fill", "currentColor");
  icon.append(path);
  return icon;
}

function iconParts(
  kind:
    | FigureResultKind
    | "annotation"
    | "languages"
    | "menu"
    | "refresh"
    | "search"
    | "trash",
): Array<[string, Record<string, string>]> {
  switch (kind) {
    case "annotation":
      return [
        [
          "path",
          {
            d: "M10 1H6v1h4zm2 3H4v8h8zM3 3v10h10V3zm11 11v-2h1v3h-3v-1zm1-8h-1v4h1zM1 6h1v4H1zm5 8h4v1H6zm6-12h2v2h1V1h-3zM2 2v2H1V1h3v1zm2 12H2v-2H1v3h3z",
            fill: "currentColor",
            "fill-rule": "evenodd",
            "clip-rule": "evenodd",
            stroke: "none",
          },
        ],
      ];
    case "languages":
      return [
        ["path", { d: "m5 8 6 11" }],
        ["path", { d: "m4 14 6.5-6.5" }],
        ["path", { d: "M2 5h12" }],
        ["path", { d: "M7 2h1" }],
        ["path", { d: "m22 22-5-10-5 10" }],
        ["path", { d: "M14 18h6" }],
      ];
    case "figure":
      return [
        [
          "rect",
          { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" },
        ],
        ["circle", { cx: "9", cy: "9", r: "2" }],
        ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
      ];
    case "table":
      return [
        ["path", { d: "M12 3v18" }],
        ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
        ["path", { d: "M3 9h18" }],
        ["path", { d: "M3 15h18" }],
      ];
    case "menu":
      return [
        ["circle", { cx: "5", cy: "12", r: "1" }],
        ["circle", { cx: "12", cy: "12", r: "1" }],
        ["circle", { cx: "19", cy: "12", r: "1" }],
      ];
    case "refresh":
      return [
        [
          "path",
          {
            d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
          },
        ],
        ["path", { d: "M3 3v5h5" }],
      ];
    case "search":
      return [
        ["circle", { cx: "11", cy: "11", r: "8" }],
        ["path", { d: "m21 21-4.3-4.3" }],
      ];
    case "trash":
      return [
        ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
        ["path", { d: "M3 6h18" }],
        ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
      ];
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
