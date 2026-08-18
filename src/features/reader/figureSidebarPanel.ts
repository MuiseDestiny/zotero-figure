import type { Rect } from "../../domain/layout";
import {
  countFigureSidebarItems,
  filterAndSortFigureSidebarItems,
  getFigureSidebarNavigationLabel,
  pruneUnavailableFigureSidebarFilters,
  shouldShowFigureSidebarEmptyState,
  toggleFigureSidebarFilter,
  type FigureSidebarFilter as DomainFigureSidebarFilter,
  type FigureSidebarFilters,
} from "../../domain/figureSidebar";
import {
  getPdfTranslateContext,
  isPdfTranslateAvailable,
  translateWithPdfTranslate,
} from "../../platform/zotero/pdfTranslate";
import { getString } from "../../utils/locale";
import { renderLatex } from "../../utils/renderLatex";
import type { PdfReader } from "../../platform/zotero/reader";
import { createDocumentBlobURL } from "../../platform/zotero/browserGlobals";
import type { FormulaLatexEditSnapshot } from "../../services/formula/formulaLatexCoordinator";
import type {
  FigureResultTranslationUpdate,
  StoredFigureResult,
} from "../../services/results/figureResultStore";
import {
  createFigureSidebarIcon,
  createNativeNoteIcon,
  createPluginIcon,
} from "./figureSidebarIcons";
import type { ResultCorrectionPreview } from "./resultRegionEditor";
import { monitorImageLoad, type ImageLoadMonitor } from "./imageLoadMonitor";
import {
  bindPinnedFigureCard,
  preparePinnedFigureCardElement,
  type PinnedCardSnapshot,
  type PinnedCardSourceGeometry,
  type PinnedFigureCard,
  type PreparePinnedCardSnapshot,
} from "./pinnedFigureCardView";
import { SidebarImageLoadCoordinator } from "./sidebarImageLoadCoordinator";
import { SidebarResultEditorController } from "./sidebarResultEditorController";

const PANEL_ID = "zoterofigure-sidebar-panel";
const TAB_ID = "zoterofigure-sidebar-tab";
const STYLE_ID = "zoterofigure-sidebar-style";
const FILTER_POPOVER_ID = "zoterofigure-filter-results";
const FILTER_POPOVER_CLOSE_DELAY_MS = 140;
const IMAGE_SINGLE_CLICK_DELAY_MS = 220;
const PINNED_CARD_Z_INDEX_BASE = 2_000_000_000;

type AnalysisProgressState = "cancelled" | "error" | "running" | "success";

interface SidebarAnalysisProgress {
  progress: number;
  state: AnalysisProgressState;
  text: string;
}

export type FigureSidebarFilter = DomainFigureSidebarFilter;

export interface FigureSidebarPanelOptions {
  getCachedTranslations(
    contextKey: string,
  ): Promise<ReadonlyMap<string, string>>;
  getResults(): Promise<readonly StoredFigureResult[]>;
  isAnalyzing(): boolean;
  onAddAllToNote(results: readonly StoredFigureResult[]): Promise<void>;
  onAddToNote(result: StoredFigureResult): Promise<void>;
  onAnalyze(): void | Promise<void>;
  onCancelAnalysis(): void;
  onCacheTranslations(
    contextKey: string,
    updates: readonly FigureResultTranslationUpdate[],
  ): Promise<ReadonlyMap<string, string>>;
  onClear(): Promise<void>;
  onCopyImage(result: StoredFigureResult): Promise<void>;
  onCopyLatex(result: StoredFigureResult): Promise<StoredFigureResult>;
  onCorrectRegion(
    result: StoredFigureResult,
    rect: Rect,
    signal: AbortSignal,
  ): Promise<StoredFigureResult | undefined>;
  onEditComment(
    result: StoredFigureResult,
    comment: string,
  ): Promise<StoredFigureResult | undefined>;
  onEditLatex(
    edit: FormulaLatexEditSnapshot,
    latex: string,
  ): Promise<StoredFigureResult | undefined>;
  onGoToPage(result: StoredFigureResult): Promise<void>;
  onPrepareCorrection(
    result: StoredFigureResult,
    signal: AbortSignal,
  ): Promise<ResultCorrectionPreview>;
  onPrepareLatexEdit(
    result: StoredFigureResult,
  ): Promise<FormulaLatexEditSnapshot | undefined>;
  onRemove(result: StoredFigureResult): Promise<void>;
  onRerecognizeLatex(result: StoredFigureResult): Promise<StoredFigureResult>;
  onResultsDisplayed(results: readonly StoredFigureResult[]): void;
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

interface PinnedCardResultSnapshot {
  displayComment: string;
  result: StoredFigureResult;
}

interface PinnedSidebarCard extends PinnedFigureCard {
  pendingSnapshot?: PinnedCardResultSnapshot;
  snapshot: PinnedCardResultSnapshot;
}

interface PreparedPinnedCardContent {
  ariaLabel: string;
  comment: HTMLElement;
  formula?: HTMLElement;
  image: HTMLImageElement;
  menuButton: HTMLButtonElement;
  start: HTMLElement;
}

export class FigureSidebarPanel {
  private active = false;
  private analysisProgress?: SidebarAnalysisProgress;
  private analysisProgressTimerID?: number;
  private document?: Document;
  private filters: FigureSidebarFilters = new Set();
  private filterPopover?: HTMLDivElement;
  private filterPopoverAnchor?: HTMLButtonElement;
  private filterPopoverCloseTimerID?: number;
  private menu?: MenuPopup;
  private menuAnchor?: Element;
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
  private readonly imageLoads: SidebarImageLoadCoordinator;
  private readonly formulaLatexErrors = new Map<string, string>();
  private readonly formulaLatexRecognitionRequests = new Map<
    string,
    Promise<StoredFigureResult>
  >();
  private readonly resultEditors: SidebarResultEditorController;
  private readonly resultCards = new Map<string, HTMLElement>();
  private resultScrollTimerID?: number;
  private imageNavigationTimerID?: number;
  private readonly pendingPinnedCards = new Map<string, number>();
  private readonly pinnedCards = new Map<string, PinnedSidebarCard>();
  private pinGeneration = 0;
  private pinnedCardZIndex = PINNED_CARD_Z_INDEX_BASE;
  private scrollContainer?: HTMLElement;
  private tab?: HTMLButtonElement;
  private tablist?: HTMLElement;
  private readonly expandedComments = new Set<string>();
  private translatedComments = new Map<string, string>();
  private translationEnabled = false;
  private translationError = false;
  private translationPending = false;
  private translationRequestID = 0;
  private disposed = false;

  private readonly handleSidebarScroll = (): void => {
    this.closeFilterPopover();
    this.imageLoads.refresh();
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

  constructor(private readonly options: FigureSidebarPanelOptions) {
    this.imageLoads = new SidebarImageLoadCoordinator({
      ownerWindow: options.ownerWindow,
    });
    this.resultEditors = new SidebarResultEditorController({
      onCorrectRegion: options.onCorrectRegion,
      onEditComment: options.onEditComment,
      onEditLatex: options.onEditLatex,
      onPrepareCorrection: options.onPrepareCorrection,
      onPrepareLatexEdit: options.onPrepareLatexEdit,
      ownerWindow: options.ownerWindow,
    });
  }

  public attach(document: Document): void {
    if (this.disposed) return;
    if (this.document && this.document !== document) {
      this.detachDocument();
    }
    this.document = document;
    this.resultEditors.setContext(document);
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

  public updateFormulaLatex(result: StoredFigureResult): void {
    if (this.disposed) return;
    if (this.loadingResults) this.reloadAfterLoad = true;
    this.applyUpdatedResult(result);
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
    if (this.active) {
      try {
        this.setInternalSidebarView(this.previousSidebarView);
      } catch (error) {
        Zotero.logError(toError(error));
      }
    }
    this.active = false;
    try {
      this.detachDocument();
    } finally {
      try {
        this.resultEditors.dispose();
      } finally {
        this.imageLoads.dispose();
      }
    }
  }

  private detachDocument(): void {
    this.renderRevision++;
    this.pinGeneration++;
    this.resultEditors.setContext(undefined);
    this.closeFilterPopover();
    this.cancelResultScroll();
    this.cancelImageNavigation();
    this.disposePinnedCards();
    this.imageLoads.setActive(false);
    this.imageLoads.setViewport(undefined);
    this.imageLoads.reset();
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
      this.imageLoads.setViewport(content);
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
    this.imageLoads.reset();
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
      this.options.onResultsDisplayed(results);
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
    this.closeMenu();
    this.reconcilePinnedCards(results);
    this.resultCards.clear();
    this.imageLoads.reset();
    this.filters = pruneUnavailableFigureSidebarFilters(
      this.filters,
      countFigureSidebarItems(results, (result) => result),
    );
    const filtered = filterAndSortFigureSidebarItems(
      results,
      this.filters,
      (result) => result,
    );
    const list = document.createElement("div");
    list.className = "zoterofigure-sidebar-list";
    if (!filtered.length) {
      if (
        shouldShowFigureSidebarEmptyState(
          filtered.length,
          Boolean(this.analysisProgress),
        )
      ) {
        list.append(this.createEmpty(document, results.length === 0));
      }
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
    this.imageLoads.refresh();
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

  private createEmpty(
    document: Document,
    canStartAnalysis: boolean,
  ): HTMLElement {
    if (canStartAnalysis) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "zoterofigure-sidebar-empty zoterofigure-sidebar-empty-action";
      button.textContent = getString("sidebar-start-analysis");
      button.disabled = this.options.isAnalyzing();
      button.addEventListener("click", () => {
        if (this.options.isAnalyzing()) return;
        void Promise.resolve(this.options.onAnalyze()).catch((error) =>
          Zotero.logError(toError(error)),
        );
      });
      return button;
    }
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

    if (this.results !== undefined) {
      const list = panelContent.querySelector<HTMLElement>(
        ".zoterofigure-sidebar-list",
      );
      const empty = list?.querySelector<HTMLElement>(
        ".zoterofigure-sidebar-empty",
      );
      const hasVisibleCards = Boolean(
        list?.querySelector(".zoterofigure-sidebar-card"),
      );
      if (
        shouldShowFigureSidebarEmptyState(
          hasVisibleCards ? 1 : 0,
          Boolean(this.analysisProgress),
        )
      ) {
        if (list && !empty) {
          list.append(this.createEmpty(document, this.results.length === 0));
        }
      } else {
        empty?.remove();
      }
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
        () => this.addAllToNote(results),
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
      if (this.disposed) return;
      // A refresh requested while deletion was in flight may have returned the
      // pre-delete manifest. Invalidate it and finish from the known empty
      // state once deletion succeeds.
      this.renderRevision++;
      this.loadingResults = false;
      this.reloadAfterLoad = false;
      this.results = [];
      this.render();
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
      const magnifier = createFigureSidebarIcon(document, "search");
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
          : createFigureSidebarIcon(document, iconKind),
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
    for (const filter of ["figure", "table", "formula"] as const) {
      if (counts[filter] === 0) continue;
      const filterResults = filterAndSortFigureSidebarItems(
        results,
        new Set([filter]),
        (result) => result,
      );
      const slot = document.createElement("div");
      slot.className = "zoterofigure-sidebar-filter-slot";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zoterofigure-sidebar-filter";
      button.dataset.filter = filter;
      const selected = this.filters.has(filter);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const filterLabel = getString(`sidebar-filter-${filter}`, {
        args: { count: counts[filter] },
      });
      button.setAttribute("aria-label", `${counts[filter]} ${filterLabel}`);

      const content = document.createElement("div");
      content.className = "zoterofigure-sidebar-filter-content";
      const icon = document.createElement("div");
      icon.className = "zoterofigure-sidebar-filter-icon";
      icon.append(createFigureSidebarIcon(document, filter));
      const count = document.createElement("span");
      count.className = "zoterofigure-sidebar-filter-count";
      count.textContent = String(counts[filter]);
      const label = document.createElement("span");
      label.className = "zoterofigure-sidebar-filter-label";
      label.textContent = filterLabel;
      content.append(icon, count, label);
      button.append(content);
      button.addEventListener("click", (event) => {
        const restoreKeyboardFocus = event.detail === 0;
        this.closeFilterPopover();
        this.filters = toggleFigureSidebarFilter(this.filters, filter);
        this.render();
        if (restoreKeyboardFocus) {
          this.panelContent
            ?.querySelector<HTMLButtonElement>(
              `.zoterofigure-sidebar-filter[data-filter="${filter}"]`,
            )
            ?.focus();
        }
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
    popover.dataset.filter = filter;
    popover.setAttribute(
      "aria-label",
      anchor.getAttribute("aria-label") ?? anchor.textContent?.trim() ?? "",
    );
    popover.setAttribute("role", "menu");

    for (const result of results) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "zoterofigure-filter-result";
      item.dataset.resultId = result.id;
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      const label = getFigureSidebarNavigationLabel({
        comment: this.getDisplayComment(result),
        tag: result.tag,
      });
      const pageLabel = getString("sidebar-page", {
        args: { page: result.pageLabel },
      });
      item.setAttribute("aria-label", `${label}, ${pageLabel}`);
      item.title = `${label} - ${pageLabel}`;
      const text = document.createElement("span");
      text.className = "zoterofigure-filter-result-label";
      text.textContent = label;
      const page = document.createElement("span");
      page.className = "zoterofigure-filter-result-page";
      page.textContent = pageLabel;
      item.append(text, page);
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
    this.positionFilterPopover(host, popover);
    if (focusItem) this.focusFilterPopoverItem(focusItem);
  }

  private positionFilterPopover(
    host: HTMLElement,
    popover: HTMLDivElement,
  ): void {
    const boundary = this.scrollContainer ?? this.panelContent;
    if (!boundary) return;
    const gutter = 6;
    const boundaryBounds = boundary.getBoundingClientRect();
    popover.style.maxWidth = `${Math.max(0, boundaryBounds.width - gutter * 2)}px`;
    const hostBounds = host.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const minimumLeft = boundaryBounds.left + gutter;
    const maximumLeft = Math.max(
      minimumLeft,
      boundaryBounds.right - popoverBounds.width - gutter,
    );
    const left = Math.min(Math.max(hostBounds.left, minimumLeft), maximumLeft);
    popover.style.insetInlineStart = `${left - hostBounds.left}px`;
    popover.style.insetInlineEnd = "auto";
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
    if (this.filters.size > 0 && !this.filters.has(filter)) {
      this.filters = new Set(this.filters).add(filter);
      this.render();
    }
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
    card.setAttribute("aria-label", this.getCardNavigationLabel(result));

    const header = document.createElement("header");
    const start = this.createCardStart(document, result);
    const end = document.createElement("div");
    end.className = "zoterofigure-card-end";
    end.append(this.createMenuButton(document, result));
    header.append(start, end);
    header.addEventListener("click", () => this.goToPage(result));

    const media = this.createCardMedia(document, result);
    this.bindCardMediaInteractions(media, result, card);
    const comment = this.createComment(document, result);
    card.append(header, media, comment);
    this.resultCards.set(result.id, card);
    return card;
  }

  private bindCardMediaInteractions(
    media: HTMLElement,
    result: StoredFigureResult,
    card: HTMLElement,
  ): void {
    media.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      this.scheduleImageNavigation(this.getCurrentResult(result.id) ?? result);
    });
    media.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancelImageNavigation();
      void this.pinCard(this.getCurrentResult(result.id) ?? result, card).catch(
        (error) => Zotero.logError(toError(error)),
      );
    });
  }

  private createCardMedia(
    document: Document,
    result: StoredFigureResult,
  ): HTMLDivElement {
    const media = document.createElement("div");
    media.className = "zoterofigure-card-image";
    if (result.kind === "formula" && result.latex) {
      media.classList.add("is-latex", "is-loaded");
      media.append(this.createRenderedLatex(document, result.latex));
      return media;
    }
    const cropWidth = result.rect[2] - result.rect[0];
    const cropHeight = result.rect[3] - result.rect[1];
    if (cropWidth > 0 && cropHeight > 0) {
      media.style.aspectRatio = `${cropWidth} / ${cropHeight}`;
    }
    this.imageLoads.register(media, result, this.getDisplayComment(result));
    return media;
  }

  private createRenderedLatex(document: Document, latex: string): HTMLElement {
    const formula = document.createElement("div");
    formula.className = "zoterofigure-rendered-latex";
    formula.setAttribute("aria-label", latex);
    renderLatex(formula, latex);
    return formula;
  }

  private createCardStart(
    document: Document,
    result: StoredFigureResult,
  ): HTMLElement {
    const start = document.createElement("div");
    start.className = "zoterofigure-card-start";
    start.append(createFigureSidebarIcon(document, result.kind));
    const page = document.createElement("span");
    page.className = "zoterofigure-card-page";
    page.textContent = getString("sidebar-page", {
      args: { page: result.pageLabel },
    });
    start.append(page);
    return start;
  }

  private getCardNavigationLabel(
    result: StoredFigureResult,
    displayComment = this.getDisplayComment(result),
  ): string {
    return getFigureSidebarNavigationLabel({
      comment: displayComment,
      tag: result.tag,
    });
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
      this.requestPinnedCardRefresh(existing, result);
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
      if (!this.getCurrentResult(result.id)) return;
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
      const cropWidth = result.rect[2] - result.rect[0];
      const cropHeight = result.rect[3] - result.rect[1];
      imageContainer.classList.remove("is-loaded");
      if (cropWidth > 0 && cropHeight > 0) {
        imageContainer.style.aspectRatio = `${cropWidth} / ${cropHeight}`;
      }
      const image = document.createElement("img");
      image.alt = this.getDisplayComment(result);
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener(
        "load",
        () => {
          imageContainer.style.aspectRatio = "";
          imageContainer.classList.add("is-loaded");
        },
        { once: true },
      );
      image.addEventListener(
        "error",
        () => {
          const placeholder = document.createElement("span");
          placeholder.className = "zoterofigure-card-image-placeholder";
          placeholder.textContent = getString("sidebar-image-unavailable");
          imageContainer.replaceChildren(placeholder);
        },
        { once: true },
      );
      if (result.kind === "formula" && result.latex) {
        imageContainer.style.aspectRatio = "";
        imageContainer.classList.add("is-latex", "is-loaded");
        imageContainer.replaceChildren(
          this.createRenderedLatex(document, result.latex),
        );
      } else {
        image.src = blobURL.url;
        imageContainer.replaceChildren(image);
      }
      this.restorePinnedCardInteractions(element, result);
      preparePinnedFigureCardElement(element, sourceGeometry);
      document.documentElement.append(element);

      const card = bindPinnedFigureCard({
        element,
        onActivate: () => this.bringPinnedCardToFront(element),
        onClose: () => this.closePinnedCard(result.id),
        ownerWindow: this.options.ownerWindow,
        releaseImageURL: blobURL.release,
        sourceGeometry,
        stagger: this.pinnedCards.size * 18,
      });
      const entry: PinnedSidebarCard = Object.assign(card, {
        snapshot: this.createPinnedCardResultSnapshot(result),
      });
      this.pinnedCards.set(result.id, entry);
      orphanedElement = undefined;
      releaseOrphanedImageURL = undefined;
      this.bringPinnedCardToFront(element);
      const currentResult = this.getCurrentResult(result.id);
      if (currentResult && currentResult !== result) {
        this.requestPinnedCardRefresh(entry, currentResult);
      }
    } finally {
      orphanedElement?.remove();
      releaseOrphanedImageURL?.();
      if (this.pendingPinnedCards.get(result.id) === generation) {
        this.pendingPinnedCards.delete(result.id);
      }
    }
  }

  private restorePinnedCardInteractions(
    element: HTMLElement,
    result: StoredFigureResult,
  ): void {
    const document = element.ownerDocument;
    const getCurrentResult = (): StoredFigureResult =>
      this.getCurrentResult(result.id) ?? result;
    const header = element.querySelector<HTMLElement>("header");
    header?.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      this.scheduleImageNavigation(getCurrentResult());
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
      this.scheduleImageNavigation(getCurrentResult());
    });
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

  private reconcilePinnedCards(results: readonly StoredFigureResult[]): void {
    const resultsByID = new Map(results.map((result) => [result.id, result]));
    for (const resultID of [...this.pinnedCards.keys()]) {
      const result = resultsByID.get(resultID);
      if (!result) {
        this.closePinnedCard(resultID);
        continue;
      }
      const entry = this.pinnedCards.get(resultID);
      if (entry) this.requestPinnedCardRefresh(entry, result);
    }
  }

  private requestPinnedCardRefresh(
    entry: PinnedSidebarCard,
    result: StoredFigureResult,
  ): void {
    const snapshot = this.createPinnedCardResultSnapshot(result);
    if (
      entry.pendingSnapshot &&
      pinnedCardSnapshotsMatch(entry.pendingSnapshot, snapshot)
    ) {
      return;
    }
    if (pinnedCardSnapshotsMatch(entry.snapshot, snapshot)) {
      if (entry.pendingSnapshot) {
        entry.pendingSnapshot = undefined;
        entry.cancelPendingSnapshotRefresh();
      }
      return;
    }

    entry.pendingSnapshot = snapshot;
    const prepare: PreparePinnedCardSnapshot = (registerCancellation) =>
      this.preparePinnedCardSnapshot(entry, snapshot, registerCancellation);
    void entry
      .refreshSnapshot(prepare)
      .catch((error) => Zotero.logError(toError(error)))
      .finally(() => {
        if (entry.pendingSnapshot === snapshot) {
          entry.pendingSnapshot = undefined;
        }
      });
  }

  private createPinnedCardResultSnapshot(
    result: StoredFigureResult,
  ): PinnedCardResultSnapshot {
    return {
      displayComment: this.getDisplayComment(result),
      result,
    };
  }

  private async preparePinnedCardSnapshot(
    entry: PinnedSidebarCard,
    snapshot: PinnedCardResultSnapshot,
    registerCancellation: (cancel: () => void) => void,
  ): Promise<PinnedCardSnapshot> {
    let cancelled = false;
    let loadMonitor: ImageLoadMonitor | undefined;
    registerCancellation(() => {
      cancelled = true;
      loadMonitor?.cancel();
    });

    const bytes = await IOUtils.read(snapshot.result.imagePath);
    if (cancelled) throw new Error("Pinned card refresh was cancelled");

    const element = entry.element;
    const document = element.ownerDocument;
    const blobURL = createDocumentBlobURL(document, [bytes], {
      type: "image/png",
    });
    let snapshotOwnsURL = false;
    try {
      if (cancelled) throw new Error("Pinned card refresh was cancelled");
      const image = document.createElement("img");
      image.alt = snapshot.displayComment;
      image.decoding = "async";
      image.draggable = false;
      loadMonitor = monitorImageLoad(image);
      if (cancelled) loadMonitor.cancel();
      image.src = blobURL.url;
      const outcome = await loadMonitor.promise;
      if (outcome !== "loaded") {
        throw new Error("Pinned card image could not be decoded");
      }

      const prepared = this.createPreparedPinnedCardContent(
        document,
        snapshot,
        image,
      );
      snapshotOwnsURL = true;
      return {
        apply: () => {
          this.applyPinnedCardSnapshot(entry, prepared);
          entry.snapshot = snapshot;
          if (entry.pendingSnapshot === snapshot) {
            entry.pendingSnapshot = undefined;
          }
        },
        release: blobURL.release,
      };
    } finally {
      if (!snapshotOwnsURL) blobURL.release();
    }
  }

  private createPreparedPinnedCardContent(
    document: Document,
    snapshot: PinnedCardResultSnapshot,
    image: HTMLImageElement,
  ): PreparedPinnedCardContent {
    const { result } = snapshot;
    return {
      ariaLabel: this.getCardNavigationLabel(result, snapshot.displayComment),
      comment: this.createComment(document, result, snapshot.displayComment),
      formula:
        result.kind === "formula" && result.latex
          ? this.createRenderedLatex(document, result.latex)
          : undefined,
      image,
      menuButton: this.createMenuButton(document, result),
      start: this.createCardStart(document, result),
    };
  }

  private applyPinnedCardSnapshot(
    entry: PinnedSidebarCard,
    content: PreparedPinnedCardContent,
  ): void {
    const element = entry.element;
    const imageContainer = element.querySelector<HTMLElement>(
      ".zoterofigure-card-image",
    );
    const start = element.querySelector<HTMLElement>(
      ".zoterofigure-card-start",
    );
    const menuHost = element.querySelector<HTMLElement>(
      ".zoterofigure-card-end",
    );
    const comment = element.querySelector<HTMLElement>(
      ".zoterofigure-card-comment",
    );
    if (!imageContainer || !start || !menuHost || !comment) {
      throw new Error("Pinned card structure changed during refresh");
    }

    if (this.menuAnchor && element.contains(this.menuAnchor)) this.closeMenu();
    element.setAttribute("aria-label", content.ariaLabel);
    start.replaceWith(content.start);
    menuHost.replaceChildren(content.menuButton);
    comment.replaceWith(content.comment);
    imageContainer.style.aspectRatio = "";
    imageContainer.classList.add("is-loaded");
    imageContainer.classList.toggle("is-latex", Boolean(content.formula));
    imageContainer.replaceChildren(content.formula ?? content.image);
  }

  private disposePinnedCards(): void {
    this.pendingPinnedCards.clear();
    for (const entry of this.pinnedCards.values()) entry.dispose();
    this.pinnedCards.clear();
    this.pinnedCardZIndex = PINNED_CARD_Z_INDEX_BASE;
  }

  private createComment(
    document: Document,
    result: StoredFigureResult,
    displayComment = this.getDisplayComment(result),
  ): HTMLElement {
    const text = displayComment.trim();
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

  private addAllToNote(results: readonly StoredFigureResult[]): Promise<void> {
    return this.options.onAddAllToNote(
      results.map((result) => this.createDisplayedResult(result)),
    );
  }

  private addResultToNote(result: StoredFigureResult): Promise<void> {
    return this.options.onAddToNote(this.createDisplayedResult(result));
  }

  private createDisplayedResult(
    result: StoredFigureResult,
  ): StoredFigureResult {
    const comment = this.getDisplayComment(result);
    return comment === result.comment ? result : { ...result, comment };
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
    this.setMenuButtonState(
      button,
      this.formulaLatexRecognitionRequests.has(result.id) ? "loading" : "menu",
    );
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
    if (result.kind === "formula") {
      this.appendMenuItem(menu, "sidebar-copy-latex", () =>
        this.copyFormulaLatex(anchor, result),
      );
      if (result.latex) {
        this.appendMenuItem(menu, "sidebar-rerecognize-latex", () =>
          this.rerecognizeFormulaLatex(anchor, result),
        );
        this.appendMenuItem(menu, "sidebar-edit-latex", () =>
          this.openLatexEditor(result),
        );
      }
    }
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
      this.addResultToNote(result),
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
    const document = this.document;
    if (!document) return;
    const updated = await this.resultEditors.editComment(result);
    if (updated && !this.disposed && this.document === document) {
      this.applyUpdatedResult(updated);
    }
  }

  private async openRegionEditor(result: StoredFigureResult): Promise<void> {
    const document = this.document;
    if (!document) return;
    const updated = await this.resultEditors.correctRegion(result);
    if (updated && !this.disposed && this.document === document) {
      this.formulaLatexErrors.delete(updated.id);
      this.reloadResults();
    }
  }

  private async openLatexEditor(result: StoredFigureResult): Promise<void> {
    const document = this.document;
    logLatexEditor(
      `[Zotero Figure][LaTeX editor] menu command: id=${result.id}, document=${document ? "ready" : "missing"}, latexLength=${result.latex?.length ?? 0}`,
    );
    if (!document || !result.latex) return;
    this.formulaLatexErrors.delete(result.id);
    try {
      const updated = await this.resultEditors.editLatex(result);
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] panel result: id=${result.id}, updated=${Boolean(updated)}`,
      );
      if (updated && !this.disposed && this.document === document) {
        this.applyUpdatedResult(updated);
      }
    } catch (error) {
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] panel caught error: id=${result.id}, message=${toError(error).message}`,
      );
      if (this.disposed || this.document !== document) return;
      this.formulaLatexErrors.set(
        result.id,
        getString("sidebar-edit-latex-failed", {
          args: { message: toError(error).message },
        }),
      );
      this.showFormulaLatexError(this.getCurrentResult(result.id) ?? result);
    }
  }

  private applyUpdatedResult(updated: StoredFigureResult): void {
    if (!this.results) return;
    const previous = this.getCurrentResult(updated.id);
    this.results = this.results.map((result) =>
      result.id === updated.id ? updated : result,
    );
    this.translationRequestID++;
    this.translationPending = false;
    this.translatedComments.delete(updated.id);
    this.formulaLatexErrors.delete(updated.id);
    this.closeFilterPopover();
    this.imageLoads.updateResult(updated, this.getDisplayComment(updated));
    const cards = [this.resultCards.get(updated.id)];
    for (const card of cards) {
      if (!card) continue;
      const document = card.ownerDocument;
      card.querySelector(".zoterofigure-card-latex-error")?.remove();
      card
        .querySelector<HTMLElement>(".zoterofigure-card-end")
        ?.replaceChildren(this.createMenuButton(document, updated));
      card
        .querySelector<HTMLElement>(".zoterofigure-card-comment")
        ?.replaceWith(this.createComment(document, updated));
      if (previous?.latex !== updated.latex) {
        this.imageLoads.unregister(updated.id);
        const currentMedia = card.querySelector<HTMLElement>(
          ".zoterofigure-card-image",
        );
        const nextMedia = this.createCardMedia(document, updated);
        this.bindCardMediaInteractions(nextMedia, updated, card);
        currentMedia?.replaceWith(nextMedia);
      }
      const image = card.querySelector<HTMLImageElement>(
        ".zoterofigure-card-image img",
      );
      if (image) image.alt = this.getDisplayComment(updated);
    }
    const pinnedCard = this.pinnedCards.get(updated.id);
    if (pinnedCard) this.requestPinnedCardRefresh(pinnedCard, updated);
    this.refreshControls();
  }

  private async copyFormulaLatex(
    anchor: HTMLButtonElement,
    result: StoredFigureResult,
  ): Promise<void> {
    this.closeMenu();
    this.formulaLatexErrors.delete(result.id);
    this.setMenuButtonState(anchor, "loading");
    const document = anchor.ownerDocument;
    const sourceCard = this.getFormulaLatexRequestCard(anchor);
    try {
      const updated = await this.options.onCopyLatex(
        this.getCurrentResult(result.id) ?? result,
      );
      if (this.disposed || this.document !== document) return;
      const currentAtCompletion = this.getCurrentResult(result.id);
      this.setFormulaLatexRequestButtonState(
        anchor,
        sourceCard,
        result.id,
        "check",
      );
      await new Promise<void>((resolve) => {
        this.options.ownerWindow.setTimeout(resolve, 900);
      });
      if (this.disposed || this.document !== document) return;
      if (this.getCurrentResult(result.id) === currentAtCompletion) {
        this.applyUpdatedResult(updated);
      }
    } catch (error) {
      if (this.disposed || this.document !== document) return;
      this.formulaLatexErrors.set(
        result.id,
        getString("sidebar-copy-latex-failed", {
          args: { message: toError(error).message },
        }),
      );
      this.showFormulaLatexError(this.getCurrentResult(result.id) ?? result);
      this.setFormulaLatexRequestButtonState(
        anchor,
        sourceCard,
        result.id,
        "menu",
      );
    }
  }

  private async rerecognizeFormulaLatex(
    anchor: HTMLButtonElement,
    result: StoredFigureResult,
  ): Promise<void> {
    this.closeMenu();
    this.formulaLatexErrors.delete(result.id);
    this.setMenuButtonState(anchor, "loading", "rerecognize");
    const document = anchor.ownerDocument;
    const sourceCard = this.getFormulaLatexRequestCard(anchor);
    let request = this.formulaLatexRecognitionRequests.get(result.id);
    const ownsRequest = request === undefined;
    if (!request) {
      request = this.options.onRerecognizeLatex(
        this.getCurrentResult(result.id) ?? result,
      );
      this.formulaLatexRecognitionRequests.set(result.id, request);
    }
    try {
      const updated = await request;
      if (
        ownsRequest &&
        this.formulaLatexRecognitionRequests.get(result.id) === request
      ) {
        this.formulaLatexRecognitionRequests.delete(result.id);
      }
      if (
        !this.disposed &&
        !this.formulaLatexRecognitionRequests.has(result.id)
      ) {
        this.resetFormulaLatexMenuButtons(result.id);
      }
      if (this.disposed || this.document !== document) return;
      const currentAtCompletion = this.getCurrentResult(result.id);
      this.setFormulaLatexRequestButtonState(
        anchor,
        sourceCard,
        result.id,
        "check",
        "rerecognize",
      );
      await new Promise<void>((resolve) => {
        this.options.ownerWindow.setTimeout(resolve, 900);
      });
      if (this.disposed || this.document !== document) return;
      if (this.getCurrentResult(result.id) === currentAtCompletion) {
        this.applyUpdatedResult(updated);
      }
    } catch (error) {
      if (
        ownsRequest &&
        this.formulaLatexRecognitionRequests.get(result.id) === request
      ) {
        this.formulaLatexRecognitionRequests.delete(result.id);
      }
      if (
        !this.disposed &&
        !this.formulaLatexRecognitionRequests.has(result.id)
      ) {
        this.resetFormulaLatexMenuButtons(result.id);
      }
      if (this.disposed || this.document !== document) return;
      this.formulaLatexErrors.set(
        result.id,
        getString("sidebar-copy-latex-failed", {
          args: { message: toError(error).message },
        }),
      );
      this.showFormulaLatexError(this.getCurrentResult(result.id) ?? result);
      this.setFormulaLatexRequestButtonState(
        anchor,
        sourceCard,
        result.id,
        "menu",
      );
    }
  }

  private resetFormulaLatexMenuButtons(resultID: string): void {
    for (const card of [
      this.resultCards.get(resultID),
      this.pinnedCards.get(resultID)?.element,
    ]) {
      const button = card?.querySelector<HTMLButtonElement>(
        ".zoterofigure-card-menu",
      );
      if (button) this.setMenuButtonState(button, "menu");
    }
  }

  private getFormulaLatexRequestCard(
    anchor: HTMLButtonElement,
  ): HTMLElement | undefined {
    return typeof anchor.closest === "function"
      ? (anchor.closest<HTMLElement>(".zoterofigure-sidebar-card") ?? undefined)
      : undefined;
  }

  private setFormulaLatexRequestButtonState(
    anchor: HTMLButtonElement,
    sourceCard: HTMLElement | undefined,
    resultID: string,
    state: "check" | "loading" | "menu",
    action: "copy" | "rerecognize" = "copy",
  ): void {
    const sourceButton =
      sourceCard?.isConnected === false
        ? undefined
        : sourceCard?.querySelector<HTMLButtonElement>(
            ".zoterofigure-card-menu",
          );
    const button =
      sourceButton ??
      this.resultCards
        .get(resultID)
        ?.querySelector<HTMLButtonElement>(".zoterofigure-card-menu") ??
      this.pinnedCards
        .get(resultID)
        ?.element.querySelector<HTMLButtonElement>(".zoterofigure-card-menu") ??
      anchor;
    this.setMenuButtonState(button, state, action);
  }

  private showFormulaLatexError(result: StoredFigureResult): void {
    const error = this.formulaLatexErrors.get(result.id);
    for (const card of [
      this.resultCards.get(result.id),
      this.pinnedCards.get(result.id)?.element,
    ]) {
      if (!card) continue;
      card.querySelector(".zoterofigure-card-latex-error")?.remove();
      if (!error) continue;
      const message = card.ownerDocument.createElement("div");
      message.className = "zoterofigure-card-latex-error";
      message.setAttribute("role", "status");
      message.textContent = error;
      card.append(message);
    }
  }

  private setMenuButtonState(
    button: HTMLButtonElement,
    state: "check" | "loading" | "menu",
    action: "copy" | "rerecognize" = "copy",
  ): void {
    const labelKey =
      state === "loading"
        ? action === "rerecognize"
          ? "sidebar-rerecognize-latex-loading"
          : "sidebar-copy-latex-loading"
        : state === "check"
          ? action === "rerecognize"
            ? "sidebar-rerecognize-latex-success"
            : "sidebar-copy-latex-success"
          : "sidebar-menu";
    button.dataset.state = state;
    button.classList.toggle("is-loading", state === "loading");
    button.classList.toggle("is-success", state === "check");
    button.disabled = state !== "menu";
    button.title = getString(labelKey);
    button.setAttribute("aria-label", getString(labelKey));
    if (state === "loading") button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
    button.replaceChildren(
      createFigureSidebarIcon(button.ownerDocument, state),
    );
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
    this.imageLoads.setActive(this.active);
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

function pinnedCardSnapshotsMatch(
  first: PinnedCardResultSnapshot,
  second: PinnedCardResultSnapshot,
): boolean {
  return (
    first.result === second.result &&
    first.displayComment === second.displayComment
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function logLatexEditor(message: string): void {
  if (typeof ztoolkit === "undefined") return;
  ztoolkit.log(message);
}
