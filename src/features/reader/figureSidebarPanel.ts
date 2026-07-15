import type { DialogHelper } from "zotero-plugin-toolkit";
import type { FigureResultKind } from "../../domain/figureResults";
import type { Rect } from "../../domain/layout";
import {
  resizeNormalizedResultRegion,
  type ResultRegionEditMode,
} from "../../domain/resultRegion";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  type FigureSidebarFilter as DomainFigureSidebarFilter,
} from "../../domain/figureSidebar";
import {
  clampPinnedCardTransform,
  getPinnedCardSmoothingProgress,
  interpolatePinnedCardTransform,
  zoomPinnedCardAtPoint,
  type Point,
  type PinnedCardTransform,
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
const PINNED_CARD_FALLBACK_WIDTH = 320;
const PINNED_CARD_DRAG_THRESHOLD = 3;
const PINNED_CARD_ZOOM_TIME_CONSTANT_MS = 55;
const PINNED_CARD_WHEEL_SENSITIVITY = 0.0015;
const PINNED_CARD_MAX_WHEEL_DELTA = 80;
const PINNED_CARD_POSITION_EPSILON = 0.1;
const PINNED_CARD_SCALE_EPSILON = 0.0005;
const PINNED_CARD_Z_INDEX_BASE = 2_000_000_000;
const COMMENT_EDITOR_MAX_LENGTH = 10_000;

type AnalysisProgressState = "cancelled" | "error" | "running" | "success";

interface SidebarAnalysisProgress {
  progress: number;
  state: AnalysisProgressState;
  text: string;
}

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
  onCorrectRegion(
    result: StoredFigureResult,
    rect: Rect,
  ): Promise<StoredFigureResult | undefined>;
  onEditComment(
    result: StoredFigureResult,
    comment: string,
  ): Promise<StoredFigureResult | undefined>;
  onGoToPage(result: StoredFigureResult): Promise<void>;
  onPrepareCorrection(
    result: StoredFigureResult,
  ): Promise<ResultCorrectionPreview>;
  onRemove(result: StoredFigureResult): Promise<void>;
  onSaveImage(result: StoredFigureResult): Promise<void>;
  onSyncAnnotations(): Promise<void>;
  ownerWindow: Window;
  reader: PdfReader;
}

export interface ResultCorrectionPreview {
  detectedRect: Rect;
  imageURL: string;
  rect: Rect;
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

interface PinnedCardSourceGeometry {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  right: number;
  top: number;
  width: number;
}

export class FigureSidebarPanel {
  private active = false;
  private analysisProgress?: SidebarAnalysisProgress;
  private analysisProgressTimerID?: number;
  private readonly blobURLReleasers = new Set<() => void>();
  private document?: Document;
  private filter: FigureSidebarFilter = "all";
  private filterPopover?: HTMLDivElement;
  private filterPopoverAnchor?: HTMLButtonElement;
  private filterPopoverCloseTimerID?: number;
  private menu?: MenuPopup;
  private menuAnchor?: Element;
  private commentEditor?: DialogHelper;
  private correctionEditor?: DialogHelper;
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
  private readonly pendingPinnedCards = new Map<string, number>();
  private readonly pinnedCards = new Map<string, PinnedFigureCard>();
  private pinGeneration = 0;
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

  private readonly handleReaderPageHide = (event: Event): void => {
    if (event.currentTarget !== this.document?.defaultView) return;
    this.detachDocument();
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
    document.defaultView?.addEventListener(
      "pagehide",
      this.handleReaderPageHide,
    );
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

  public updateAnalysisProgress(
    text: string,
    progress: number,
    state: AnalysisProgressState = "running",
    clearAfterMs?: number,
  ): void {
    if (this.disposed) return;
    if (this.analysisProgressTimerID !== undefined) {
      this.options.ownerWindow.clearTimeout(this.analysisProgressTimerID);
      this.analysisProgressTimerID = undefined;
    }
    const value: SidebarAnalysisProgress = {
      progress: Math.max(0, Math.min(100, progress)),
      state,
      text,
    };
    this.analysisProgress = value;
    this.refreshAnalysisProgress();
    if (clearAfterMs !== undefined) {
      this.analysisProgressTimerID = this.options.ownerWindow.setTimeout(() => {
        this.analysisProgressTimerID = undefined;
        if (this.analysisProgress !== value) return;
        this.analysisProgress = undefined;
        this.refreshAnalysisProgress();
      }, clearAfterMs);
    }
  }

  public reloadResults(): void {
    if (this.disposed || !this.panelContent) return;
    this.requestResults(this.panelContent, true);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.analysisProgressTimerID !== undefined) {
      this.options.ownerWindow.clearTimeout(this.analysisProgressTimerID);
      this.analysisProgressTimerID = undefined;
    }
    this.translationRequestID++;
    this.expandedComments.clear();
    this.translatedComments.clear();
    if (this.active) this.setInternalSidebarView(this.previousSidebarView);
    this.active = false;
    this.detachDocument();
  }

  private detachDocument(): void {
    this.renderRevision++;
    this.pinGeneration++;
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
    this.closeMenu();
    this.commentEditor?.window?.close();
    this.commentEditor = undefined;
    this.correctionEditor?.window?.close();
    this.correctionEditor = undefined;
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
    this.document?.defaultView?.removeEventListener(
      "pagehide",
      this.handleReaderPageHide,
    );
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
    this.cancelImageNavigation();
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
    this.cancelImageNavigation();
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
      if (!this.analysisProgress) list.append(this.createEmpty(document));
    } else {
      for (const result of filtered) list.append(this.createCard(result));
    }
    const children: HTMLElement[] = [this.createControls(document, results)];
    if (this.analysisProgress) {
      children.push(
        this.createAnalysisProgress(document, this.analysisProgress),
      );
    }
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

  private createEmpty(document: Document): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "zoterofigure-sidebar-empty";
    empty.textContent = getString("sidebar-empty");
    return empty;
  }

  private createAnalysisProgress(
    document: Document,
    value: SidebarAnalysisProgress,
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = `zoterofigure-analysis-progress is-${value.state}`;
    container.setAttribute("role", "progressbar");
    container.setAttribute("aria-valuemin", "0");
    container.setAttribute("aria-valuemax", "100");
    container.setAttribute("aria-valuenow", String(Math.round(value.progress)));
    container.setAttribute(
      "aria-label",
      getString("sidebar-analysis-progress-title"),
    );

    const heading = document.createElement("div");
    heading.className = "zoterofigure-analysis-progress-heading";
    const title = document.createElement("span");
    title.textContent = getString("sidebar-analysis-progress-title");
    const percentage = document.createElement("span");
    percentage.className = "zoterofigure-analysis-progress-percentage";
    percentage.textContent = `${Math.round(value.progress)}%`;
    heading.append(title, percentage);

    const track = document.createElement("div");
    track.className = "zoterofigure-analysis-progress-track";
    const fill = document.createElement("div");
    fill.className = "zoterofigure-analysis-progress-fill";
    fill.style.width = `${value.progress}%`;
    track.append(fill);

    const detail = document.createElement("div");
    detail.className = "zoterofigure-analysis-progress-detail";
    detail.textContent = value.text;
    container.append(heading, track, detail);
    return container;
  }

  private refreshAnalysisProgress(): void {
    const document = this.document;
    const panelContent = this.panelContent;
    if (!document || !panelContent) return;
    const current = panelContent.querySelector<HTMLElement>(
      ".zoterofigure-analysis-progress",
    );
    if (this.analysisProgress) {
      if (current) {
        current.className = `zoterofigure-analysis-progress is-${this.analysisProgress.state}`;
        current.setAttribute(
          "aria-valuenow",
          String(Math.round(this.analysisProgress.progress)),
        );
        const percentage = current.querySelector<HTMLElement>(
          ".zoterofigure-analysis-progress-percentage",
        );
        if (percentage) {
          percentage.textContent = `${Math.round(this.analysisProgress.progress)}%`;
        }
        const fill = current.querySelector<HTMLElement>(
          ".zoterofigure-analysis-progress-fill",
        );
        if (fill) fill.style.width = `${this.analysisProgress.progress}%`;
        const detail = current.querySelector<HTMLElement>(
          ".zoterofigure-analysis-progress-detail",
        );
        if (detail) detail.textContent = this.analysisProgress.text;
      } else {
        const next = this.createAnalysisProgress(
          document,
          this.analysisProgress,
        );
        const controls = panelContent.querySelector<HTMLElement>(
          ".zoterofigure-sidebar-controls",
        );
        if (controls) controls.after(next);
        else panelContent.prepend(next);
      }
    } else {
      current?.remove();
    }

    if (this.results?.length === 0) {
      const list = panelContent.querySelector<HTMLElement>(
        ".zoterofigure-sidebar-list",
      );
      const empty = list?.querySelector<HTMLElement>(
        ".zoterofigure-sidebar-empty",
      );
      if (this.analysisProgress) empty?.remove();
      else if (list && !empty) list.append(this.createEmpty(document));
    }
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
    for (const filter of ["all", "figure", "table", "formula"] as const) {
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
          this.openFilterPopover(document, slot, button, filter, filterResults),
        );
        button.addEventListener("mouseleave", () =>
          this.scheduleFilterPopoverClose(),
        );
        button.addEventListener("focus", () =>
          this.openFilterPopover(document, slot, button, filter, filterResults),
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
      this.scheduleImageNavigation(this.getCurrentResult(result.id) ?? result);
    });
    image.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancelImageNavigation();
      void this.pinCard(this.getCurrentResult(result.id) ?? result, card).catch(
        (error) => Zotero.logError(toError(error)),
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
    if (this.pendingPinnedCards.has(result.id)) return;
    const document = this.document;
    if (!document) return;
    const generation = this.pinGeneration;

    this.pendingPinnedCards.set(result.id, generation);
    let orphanedElement: HTMLElement | undefined;
    let releaseOrphanedImageURL: (() => void) | undefined;
    try {
      const bytes = await IOUtils.read(result.imagePath);
      if (
        this.disposed ||
        this.document !== document ||
        this.pinGeneration !== generation
      ) {
        return;
      }
      const blobURL = createDocumentBlobURL(document, [bytes], {
        type: "image/png",
      });
      releaseOrphanedImageURL = blobURL.release;
      if (
        this.disposed ||
        this.document !== document ||
        this.pinGeneration !== generation
      ) {
        return;
      }
      if (!sourceCard.isConnected) return;
      const sourceBounds = sourceCard.getBoundingClientRect();
      const sourceStyle = document.defaultView?.getComputedStyle(sourceCard);
      const sourceGeometry: PinnedCardSourceGeometry = {
        fontFamily: sourceStyle?.fontFamily ?? "",
        fontSize: sourceStyle?.fontSize ?? "",
        lineHeight: sourceStyle?.lineHeight ?? "",
        right: sourceBounds.right,
        top: sourceBounds.top,
        width: sourceBounds.width,
      };

      const element = sourceCard.cloneNode(true) as HTMLElement;
      orphanedElement = element;
      const imageContainer = element.querySelector<HTMLElement>(
        ".zoterofigure-card-image",
      );
      if (!imageContainer) return;
      const image = document.createElement("img");
      image.alt = this.getDisplayComment(result);
      image.decoding = "async";
      image.draggable = false;
      image.src = blobURL.url;
      imageContainer.replaceChildren(image);
      this.restorePinnedCardInteractions(element, result);
      this.preparePinnedCardElement(element, sourceGeometry);
      document.documentElement.append(element);

      const entry = this.bindPinnedCard(
        result.id,
        element,
        blobURL.release,
        sourceGeometry,
      );
      this.pinnedCards.set(result.id, entry);
      orphanedElement = undefined;
      releaseOrphanedImageURL = undefined;
      this.bringPinnedCardToFront(element);
    } finally {
      orphanedElement?.remove();
      releaseOrphanedImageURL?.();
      if (this.pendingPinnedCards.get(result.id) === generation) {
        this.pendingPinnedCards.delete(result.id);
      }
    }
  }

  private preparePinnedCardElement(
    element: HTMLElement,
    sourceGeometry: PinnedCardSourceGeometry,
  ): void {
    const document = element.ownerDocument;
    const root = document.documentElement;
    const availableWidth = Math.max(
      1,
      root.clientWidth - PINNED_CARD_MARGIN * 2,
    );
    const width = Math.min(
      availableWidth,
      sourceGeometry.width > 0
        ? sourceGeometry.width
        : PINNED_CARD_FALLBACK_WIDTH,
    );
    element.classList.add("zoterofigure-pinned-card");
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.transform = "translate3d(0, 0, 0) scale(1)";
    element.style.width = `${width}px`;
    if (sourceGeometry.fontFamily) {
      element.style.fontFamily = sourceGeometry.fontFamily;
    }
    if (sourceGeometry.fontSize) {
      element.style.fontSize = sourceGeometry.fontSize;
    }
    if (sourceGeometry.lineHeight) {
      element.style.lineHeight = sourceGeometry.lineHeight;
    }
    element.tabIndex = 0;
  }

  private restorePinnedCardInteractions(
    element: HTMLElement,
    result: StoredFigureResult,
  ): void {
    const document = element.ownerDocument;
    const header = element.querySelector<HTMLElement>("header");
    header?.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      this.scheduleImageNavigation(result);
    });

    const menuHost = element.querySelector<HTMLElement>(
      ".zoterofigure-card-end",
    );
    menuHost?.replaceChildren(this.createMenuButton(document, result));

    const existingComment = element.querySelector<HTMLElement>(
      ".zoterofigure-card-comment",
    );
    existingComment?.replaceWith(this.createComment(document, result));

    const image = element.querySelector<HTMLElement>(
      ".zoterofigure-card-image",
    );
    image?.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      this.scheduleImageNavigation(result);
    });
  }

  private bindPinnedCard(
    resultID: string,
    element: HTMLElement,
    releaseImageURL: () => void,
    sourceGeometry: PinnedCardSourceGeometry,
  ): PinnedFigureCard {
    const document = element.ownerDocument;
    const root = document.documentElement;
    const baseBounds = element.getBoundingClientRect();
    const cardSize: Size = {
      height: baseBounds.height,
      width: baseBounds.width,
    };
    const stagger = this.pinnedCards.size * 18;
    const initialPosition: Point = {
      x: sourceGeometry.right + PINNED_CARD_MARGIN + stagger,
      y: sourceGeometry.top + stagger,
    };
    let transform = clampPinnedCardTransform(
      {
        scale: 1,
        ...initialPosition,
      },
      cardSize,
      getDocumentViewportSize(document),
      PINNED_CARD_MARGIN,
    );
    let renderedTransform = { ...transform };
    let transformFrameID: number | undefined;
    let previousTransformFrameTime: number | undefined;
    let draggingPointerID: number | undefined;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let cardStartX = 0;
    let cardStartY = 0;
    let dragMoved = false;
    let suppressNextClick = false;
    let suppressClickTimerID: number | undefined;

    const renderTransform = (value: PinnedCardTransform): void => {
      element.style.transform = `translate3d(${value.x}px, ${value.y}px, 0) scale(${value.scale})`;
    };
    const cancelTransformAnimation = (): void => {
      if (transformFrameID === undefined) return;
      cancelAnimationFrame(transformFrameID);
      transformFrameID = undefined;
      previousTransformFrameTime = undefined;
    };
    const applyTransformImmediately = (): void => {
      cancelTransformAnimation();
      renderedTransform = { ...transform };
      renderTransform(renderedTransform);
    };
    const animateTransform = (): void => {
      if (transformFrameID !== undefined) return;
      const step = (frameTime: number): void => {
        transformFrameID = undefined;
        const elapsedMilliseconds = Math.min(
          64,
          Math.max(
            0,
            previousTransformFrameTime === undefined
              ? 1000 / 60
              : frameTime - previousTransformFrameTime,
          ),
        );
        previousTransformFrameTime = frameTime;
        renderedTransform = interpolatePinnedCardTransform(
          renderedTransform,
          transform,
          getPinnedCardSmoothingProgress(
            elapsedMilliseconds,
            PINNED_CARD_ZOOM_TIME_CONSTANT_MS,
          ),
        );
        const settled = pinnedCardTransformsAreClose(
          renderedTransform,
          transform,
        );
        if (settled) renderedTransform = { ...transform };
        renderTransform(renderedTransform);
        if (!settled) transformFrameID = requestAnimationFrame(step);
        else previousTransformFrameTime = undefined;
      };
      transformFrameID = requestAnimationFrame(step);
    };
    const updateClampedTransform = (): void => {
      transform = clampPinnedCardTransform(
        transform,
        cardSize,
        getDocumentViewportSize(document),
        PINNED_CARD_MARGIN,
      );
    };
    const clampToViewport = (): void => {
      updateClampedTransform();
      applyTransformImmediately();
    };
    const animateToClampedTransform = (): void => {
      updateClampedTransform();
      animateTransform();
    };
    const adoptRenderedTransform = (): void => {
      cancelTransformAnimation();
      transform = { ...renderedTransform };
      renderTransform(renderedTransform);
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !event.isPrimary) return;
      this.bringPinnedCardToFront(element);
      const target = event.target as Element | null;
      if (target?.closest("button, a, input, select, textarea")) return;
      event.stopPropagation();
      adoptRenderedTransform();
      element.focus({ preventScroll: true });
      draggingPointerID = event.pointerId;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
      cardStartX = transform.x;
      cardStartY = transform.y;
      dragMoved = false;
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== draggingPointerID) return;
      const deltaX = event.clientX - pointerStartX;
      const deltaY = event.clientY - pointerStartY;
      if (
        !dragMoved &&
        Math.hypot(deltaX, deltaY) < PINNED_CARD_DRAG_THRESHOLD
      ) {
        return;
      }
      event.preventDefault();
      if (!dragMoved) {
        dragMoved = true;
        element.classList.add("is-dragging");
        element.setPointerCapture(event.pointerId);
      }
      transform = {
        ...transform,
        x: cardStartX + deltaX,
        y: cardStartY + deltaY,
      };
      clampToViewport();
    };
    const stopDragging = (event: PointerEvent): void => {
      if (event.pointerId !== draggingPointerID) return;
      draggingPointerID = undefined;
      element.classList.remove("is-dragging");
      if (dragMoved) {
        suppressNextClick = true;
        if (suppressClickTimerID !== undefined) {
          this.options.ownerWindow.clearTimeout(suppressClickTimerID);
        }
        suppressClickTimerID = this.options.ownerWindow.setTimeout(() => {
          suppressClickTimerID = undefined;
          suppressNextClick = false;
        }, 50);
      }
      dragMoved = false;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const handleClickCapture = (event: MouseEvent): void => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.bringPinnedCardToFront(element);
      const boundedDelta = Math.max(
        -PINNED_CARD_MAX_WHEEL_DELTA,
        Math.min(
          PINNED_CARD_MAX_WHEEL_DELTA,
          normalizeWheelDelta(event, root.clientHeight),
        ),
      );
      const nextScale = Math.max(
        PINNED_CARD_MIN_SCALE,
        Math.min(
          PINNED_CARD_MAX_SCALE,
          transform.scale *
            Math.exp(-boundedDelta * PINNED_CARD_WHEEL_SENSITIVITY),
        ),
      );
      transform = zoomPinnedCardAtPoint(transform, nextScale, {
        x: event.clientX,
        y: event.clientY,
      });
      animateToClampedTransform();
    };
    const handleDoubleClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest("button, a, input, select, textarea")) return;
      event.preventDefault();
      event.stopPropagation();
      this.cancelImageNavigation();
      this.closePinnedCard(resultID);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closePinnedCard(resultID);
    };
    const view = document.defaultView;

    element.addEventListener("click", handleClickCapture, true);
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", stopDragging);
    element.addEventListener("pointercancel", stopDragging);
    element.addEventListener("lostpointercapture", stopDragging);
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("dblclick", handleDoubleClick);
    element.addEventListener("keydown", handleKeyDown);
    view?.addEventListener("resize", clampToViewport);
    applyTransformImmediately();

    let disposed = false;
    return {
      element,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (suppressClickTimerID !== undefined) {
          this.options.ownerWindow.clearTimeout(suppressClickTimerID);
        }
        cancelTransformAnimation();
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
    this.cancelImageNavigation();
    if (this.menuAnchor && entry.element.contains(this.menuAnchor)) {
      this.closeMenu();
    }
    this.pinnedCards.delete(resultID);
    entry.dispose();
  }

  private disposePinnedCards(): void {
    this.pendingPinnedCards.clear();
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
    this.applyCommentExpansion(comment, expanded);
    const textNode = document.createElement("span");
    textNode.className = "zoterofigure-card-comment-text";
    textNode.textContent = text;
    comment.append(textNode);
    comment.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setCommentExpansion(
        result.id,
        !comment.classList.contains("expanded"),
      );
    });
    return comment;
  }

  private setCommentExpansion(resultID: string, expanded: boolean): void {
    if (expanded) this.expandedComments.add(resultID);
    else this.expandedComments.delete(resultID);
    const cards = [
      this.resultCards.get(resultID),
      this.pinnedCards.get(resultID)?.element,
    ];
    for (const card of cards) {
      const comment = card?.querySelector<HTMLElement>(
        ".zoterofigure-card-comment:not(.is-empty)",
      );
      if (comment) this.applyCommentExpansion(comment, expanded);
    }
  }

  private applyCommentExpansion(comment: HTMLElement, expanded: boolean): void {
    comment.classList.toggle("expanded", expanded);
    comment.setAttribute("aria-expanded", String(expanded));
    comment.setAttribute(
      "aria-label",
      getString(
        expanded ? "sidebar-collapse-caption" : "sidebar-expand-caption",
      ),
    );
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
    this.closeMenu();
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
    const sourceCard = anchor.closest<HTMLElement>(
      ".zoterofigure-sidebar-card:not(.zoterofigure-pinned-card)",
    );
    if (sourceCard) {
      this.appendMenuItem(menu, "sidebar-pin-image", () => {
        this.cancelImageNavigation();
        return this.pinCard(result, sourceCard);
      });
    }
    this.appendMenuItem(menu, "sidebar-go-to-page", () =>
      this.options.onGoToPage(result),
    );
    this.appendMenuItem(menu, "sidebar-edit-comment", () =>
      this.openCommentEditor(result),
    );
    this.appendMenuItem(menu, "sidebar-correct-region", () =>
      this.openRegionEditor(result),
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
    this.menu = menu;
    this.menuAnchor = anchor;
    menu.addEventListener(
      "popuphidden",
      () => {
        menu.remove();
        if (this.menu !== menu) return;
        this.menu = undefined;
        this.menuAnchor = undefined;
      },
      { once: true },
    );
    menu.openPopup(anchor, "after_start", 0, 0, false, false);
  }

  private closeMenu(): void {
    const menu = this.menu;
    this.menu = undefined;
    this.menuAnchor = undefined;
    menu?.remove();
  }

  private async openCommentEditor(result: StoredFigureResult): Promise<void> {
    this.commentEditor?.window?.close();
    const dialogData: {
      _lastButtonId?: string;
      comment: string;
      unloadLock?: { promise: Promise<void>; resolve: () => void };
    } = { comment: result.comment };
    const dialog = new ztoolkit.Dialog(1, 1)
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "div",
        styles: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minWidth: "420px",
          width: "100%",
        },
        children: [
          {
            tag: "label",
            attributes: { for: "zoterofigure-comment-editor" },
            properties: {
              textContent: getString("sidebar-edit-comment-description"),
            },
            styles: {
              color: "var(--fill-secondary)",
              fontSize: "12px",
            },
          },
          {
            tag: "textarea",
            id: "zoterofigure-comment-editor",
            attributes: {
              "data-bind": "comment",
              "data-prop": "value",
              maxlength: COMMENT_EDITOR_MAX_LENGTH,
              rows: 2,
            },
            styles: {
              background: "var(--material-background)",
              border: "1px solid var(--fill-quaternary)",
              borderRadius: "5px",
              boxSizing: "border-box",
              color: "var(--fill-primary)",
              font: "inherit",
              lineHeight: "1.45",
              height: "4.1em",
              maxHeight: "4.1em",
              minHeight: "4.1em",
              overflowY: "auto",
              padding: "8px",
              resize: "none",
              width: "100%",
            },
          },
        ],
      })
      .addButton(getString("sidebar-edit-comment-save"), "save")
      .addButton(getString("sidebar-edit-comment-cancel"), "cancel")
      .open(getString("sidebar-edit-comment-title"), {
        centerscreen: true,
        fitContent: true,
        noDialogMode: true,
        resizable: true,
      });
    this.commentEditor = dialog;
    dialog.window.addEventListener(
      "load",
      () => {
        const textarea =
          dialog.window.document.querySelector<HTMLTextAreaElement>(
            "#zoterofigure-comment-editor",
          );
        textarea?.focus();
        textarea?.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      },
      { once: true },
    );
    try {
      await dialogData.unloadLock?.promise;
      if (dialogData._lastButtonId !== "save") return;
      const updated = await this.options.onEditComment(
        result,
        dialogData.comment,
      );
      if (updated) this.applyUpdatedResult(updated);
    } finally {
      if (this.commentEditor === dialog) this.commentEditor = undefined;
    }
  }

  private async openRegionEditor(result: StoredFigureResult): Promise<void> {
    this.correctionEditor?.window?.close();
    const preview = await this.options.onPrepareCorrection(result);
    const dialogData: {
      _lastButtonId?: string;
      rect: Rect;
      unloadLock?: { promise: Promise<void>; resolve: () => void };
    } = { rect: [...preview.rect] };
    const dialog = new ztoolkit.Dialog(1, 1)
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "div",
        id: "zoterofigure-region-editor",
      })
      .addButton(getString("sidebar-correct-region-save"), "save")
      .addButton(getString("sidebar-correct-region-cancel"), "cancel")
      .open(getString("sidebar-correct-region-title"), {
        centerscreen: true,
        fitContent: true,
        noDialogMode: true,
        resizable: true,
      });
    this.correctionEditor = dialog;
    let cleanup = () => {};
    dialog.window.addEventListener(
      "load",
      () => {
        const host = dialog.window.document.querySelector<HTMLElement>(
          "#zoterofigure-region-editor",
        );
        if (host) {
          cleanup = installRegionEditor(
            dialog.window.document,
            host,
            preview,
            dialogData,
          );
        }
      },
      { once: true },
    );
    try {
      await dialogData.unloadLock?.promise;
      if (dialogData._lastButtonId !== "save") return;
      const updated = await this.options.onCorrectRegion(
        result,
        dialogData.rect,
      );
      if (!updated) return;
      this.closePinnedCard(result.id);
      this.reloadResults();
    } finally {
      cleanup();
      if (this.correctionEditor === dialog) this.correctionEditor = undefined;
    }
  }

  private applyUpdatedResult(updated: StoredFigureResult): void {
    if (!this.results) return;
    this.results = this.results.map((result) =>
      result.id === updated.id ? updated : result,
    );
    this.translationRequestID++;
    this.translationPending = false;
    this.translatedComments.delete(updated.id);
    this.closeFilterPopover();
    for (const entry of this.imageEntries) {
      if (entry.result.id !== updated.id) continue;
      entry.result = updated;
      entry.image.alt = updated.comment;
    }
    const cards = [
      this.resultCards.get(updated.id),
      this.pinnedCards.get(updated.id)?.element,
    ];
    for (const card of cards) {
      if (!card) continue;
      const document = card.ownerDocument;
      card
        .querySelector<HTMLElement>(".zoterofigure-card-end")
        ?.replaceChildren(this.createMenuButton(document, updated));
      card
        .querySelector<HTMLElement>(".zoterofigure-card-comment")
        ?.replaceWith(this.createComment(document, updated));
      const image = card.querySelector<HTMLImageElement>(
        ".zoterofigure-card-image img",
      );
      if (image) image.alt = updated.comment;
    }
    this.refreshControls();
  }

  private getCurrentResult(resultID: string): StoredFigureResult | undefined {
    return this.results?.find((result) => result.id === resultID);
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

function getDocumentViewportSize(document: Document): Size {
  return {
    height: document.documentElement.clientHeight,
    width: document.documentElement.clientWidth,
  };
}

function pinnedCardTransformsAreClose(
  current: PinnedCardTransform,
  target: PinnedCardTransform,
): boolean {
  return (
    Math.abs(current.x - target.x) <= PINNED_CARD_POSITION_EPSILON &&
    Math.abs(current.y - target.y) <= PINNED_CARD_POSITION_EPSILON &&
    Math.abs(current.scale - target.scale) <= PINNED_CARD_SCALE_EPSILON
  );
}

function normalizeWheelDelta(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}

function installRegionEditor(
  document: Document,
  host: HTMLElement,
  preview: ResultCorrectionPreview,
  dialogData: { rect: Rect },
): () => void {
  const style = document.createElement("style");
  style.textContent = `
    #zoterofigure-region-editor {
      align-items: center;
      display: flex;
      flex-direction: column;
      max-width: 80vw;
      min-width: 420px;
    }
    #zoterofigure-region-stage {
      background: var(--material-mix-quinary);
      display: inline-block;
      line-height: 0;
      overflow: hidden;
      position: relative;
    }
    #zoterofigure-region-page {
      display: block;
      height: auto;
      max-height: 68vh;
      max-width: min(720px, 78vw);
      user-select: none;
      width: auto;
    }
    #zoterofigure-region-selection {
      background: color-mix(in srgb, var(--accent-blue, #3b82f6) 14%, transparent);
      border: 2px solid var(--accent-blue, #3b82f6);
      box-sizing: border-box;
      cursor: move;
      position: absolute;
      touch-action: none;
    }
    .zoterofigure-region-handle {
      background: var(--material-background);
      border: 2px solid var(--accent-blue, #3b82f6);
      box-sizing: border-box;
      height: 12px;
      position: absolute;
      width: 12px;
    }
    .zoterofigure-region-handle[data-handle="nw"] { cursor: nwse-resize; left: 0; top: 0; transform: translate(-50%, -50%); }
    .zoterofigure-region-handle[data-handle="ne"] { cursor: nesw-resize; right: 0; top: 0; transform: translate(50%, -50%); }
    .zoterofigure-region-handle[data-handle="sw"] { bottom: 0; cursor: nesw-resize; left: 0; transform: translate(-50%, 50%); }
    .zoterofigure-region-handle[data-handle="se"] { bottom: 0; cursor: nwse-resize; right: 0; transform: translate(50%, 50%); }
    #zoterofigure-region-reset {
      align-self: flex-start;
      margin-top: 8px;
    }
  `;

  const stage = document.createElement("div");
  stage.id = "zoterofigure-region-stage";
  const image = document.createElement("img");
  image.id = "zoterofigure-region-page";
  image.alt = "";
  image.draggable = false;
  image.src = preview.imageURL;
  const selection = document.createElement("div");
  selection.id = "zoterofigure-region-selection";
  selection.setAttribute(
    "aria-label",
    getString("sidebar-correct-region-selection"),
  );
  for (const handle of ["nw", "ne", "sw", "se"] as const) {
    const node = document.createElement("span");
    node.className = "zoterofigure-region-handle";
    node.dataset.handle = handle;
    node.setAttribute("aria-hidden", "true");
    selection.append(node);
  }
  stage.append(image, selection);
  const reset = document.createElement("button");
  reset.id = "zoterofigure-region-reset";
  reset.type = "button";
  reset.textContent = getString("sidebar-correct-region-reset");
  host.replaceChildren(style, stage, reset);

  const originalRect = [...preview.detectedRect] as Rect;
  const render = () => {
    const [left, top, right, bottom] = dialogData.rect;
    selection.style.left = `${left * 100}%`;
    selection.style.top = `${top * 100}%`;
    selection.style.width = `${(right - left) * 100}%`;
    selection.style.height = `${(bottom - top) * 100}%`;
  };
  render();

  const view = document.defaultView;
  let pointerID: number | undefined;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let startRect = [...dialogData.rect] as Rect;
  let mode: ResultRegionEditMode = "move";
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || pointerID !== undefined) return;
    event.preventDefault();
    pointerID = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    startRect = [...dialogData.rect];
    const handle = (event.target as HTMLElement).dataset.handle;
    mode =
      handle === "ne" || handle === "nw" || handle === "se" || handle === "sw"
        ? handle
        : "move";
    selection.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerID) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const deltaX = (event.clientX - pointerStartX) / bounds.width;
    const deltaY = (event.clientY - pointerStartY) / bounds.height;
    dialogData.rect = resizeNormalizedResultRegion(
      startRect,
      mode,
      deltaX,
      deltaY,
    );
    render();
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerID) return;
    if (selection.hasPointerCapture(event.pointerId)) {
      selection.releasePointerCapture(event.pointerId);
    }
    pointerID = undefined;
  };
  const handleReset = () => {
    dialogData.rect = [...originalRect];
    render();
  };
  selection.addEventListener("pointerdown", handlePointerDown);
  view?.addEventListener("pointermove", handlePointerMove);
  view?.addEventListener("pointerup", handlePointerUp);
  view?.addEventListener("pointercancel", handlePointerUp);
  reset.addEventListener("click", handleReset);

  return () => {
    selection.removeEventListener("pointerdown", handlePointerDown);
    view?.removeEventListener("pointermove", handlePointerMove);
    view?.removeEventListener("pointerup", handlePointerUp);
    view?.removeEventListener("pointercancel", handlePointerUp);
    reset.removeEventListener("click", handleReset);
  };
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
    case "formula":
      return [
        [
          "path",
          {
            d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
          },
        ],
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
