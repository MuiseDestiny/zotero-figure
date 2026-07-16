import {
  clampPinnedCardTransform,
  getPinnedCardSmoothingProgress,
  interpolatePinnedCardTransform,
  zoomPinnedCardAtPoint,
  type Point,
  type PinnedCardTransform,
  type Size,
} from "../../domain/pinnedFigureCard";

const CARD_MARGIN = 12;
const MAX_SCALE = 3;
const MIN_SCALE = 0.35;
const FALLBACK_WIDTH = 320;
const DRAG_THRESHOLD = 3;
const ZOOM_TIME_CONSTANT_MS = 55;
const WHEEL_SENSITIVITY = 0.0015;
const MAX_WHEEL_DELTA = 80;
const POSITION_EPSILON = 0.1;
const SCALE_EPSILON = 0.0005;
const PINNED_LATEX_FONT_SIZE_PROPERTY = "--zoterofigure-pinned-latex-font-size";

export interface PinnedFigureCard {
  cancelPendingSnapshotRefresh(): void;
  dispose(): void;
  element: HTMLElement;
  refreshSnapshot(prepare: PreparePinnedCardSnapshot): Promise<boolean>;
}

export interface PinnedCardSnapshot {
  apply(): void;
  release(): void;
}

export type PreparePinnedCardSnapshot = (
  registerCancellation: (cancel: () => void) => void,
) => Promise<PinnedCardSnapshot>;

export interface PinnedCardSourceGeometry {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  right: number;
  top: number;
  width: number;
}

interface BindPinnedFigureCardOptions {
  element: HTMLElement;
  onActivate(): void;
  onClose(): void;
  ownerWindow: Window;
  releaseImageURL(): void;
  sourceGeometry: PinnedCardSourceGeometry;
  stagger: number;
}

/** Owns the currently displayed Blob and atomically swaps prepared snapshots. */
export class PinnedCardSnapshotSlot {
  private cancelPendingPreparation?: () => void;
  private disposed = false;
  private generation = 0;

  constructor(private releaseCurrent: () => void) {}

  public async refresh(prepare: PreparePinnedCardSnapshot): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.cancelPendingPreparation?.();
    this.cancelPendingPreparation = undefined;
    let registeredCancellation: (() => void) | undefined;
    const registerCancellation = (cancel: () => void): void => {
      if (this.disposed || generation !== this.generation) {
        cancel();
        return;
      }
      registeredCancellation = cancel;
      this.cancelPendingPreparation = cancel;
    };

    let snapshot: PinnedCardSnapshot;
    try {
      snapshot = await prepare(registerCancellation);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return false;
      throw error;
    } finally {
      if (
        registeredCancellation &&
        this.cancelPendingPreparation === registeredCancellation
      ) {
        this.cancelPendingPreparation = undefined;
      }
    }

    if (this.disposed || generation !== this.generation) {
      snapshot.release();
      return false;
    }
    try {
      snapshot.apply();
    } catch (error) {
      snapshot.release();
      throw error;
    }
    const releasePrevious = this.releaseCurrent;
    this.releaseCurrent = snapshot.release;
    releasePrevious();
    return true;
  }

  public cancelPendingRefresh(): void {
    if (this.disposed) return;
    this.generation++;
    this.cancelPendingPreparation?.();
    this.cancelPendingPreparation = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.cancelPendingPreparation?.();
    this.cancelPendingPreparation = undefined;
    this.releaseCurrent();
  }
}

export function preparePinnedFigureCardElement(
  element: HTMLElement,
  sourceGeometry: PinnedCardSourceGeometry,
): void {
  const root = element.ownerDocument.documentElement;
  const availableWidth = Math.max(1, root.clientWidth - CARD_MARGIN * 2);
  const width = Math.min(
    availableWidth,
    sourceGeometry.width > 0 ? sourceGeometry.width : FALLBACK_WIDTH,
  );
  element.classList.add("zoterofigure-pinned-card");
  element.style.left = "0px";
  element.style.top = "0px";
  element.style.transform = "translate3d(0, 0, 0)";
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

export function getPinnedCardRenderStyles(
  transform: PinnedCardTransform,
  baseWidth: number,
): { latexFontSize: string; transform: string; width: string } {
  return {
    latexFontSize: `${Math.max(0.01, transform.scale)}em`,
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    width: `${Math.max(1, baseWidth * transform.scale)}px`,
  };
}

export function bindPinnedFigureCard(
  options: BindPinnedFigureCardOptions,
): PinnedFigureCard {
  const {
    element,
    onActivate,
    onClose,
    ownerWindow,
    releaseImageURL,
    sourceGeometry,
    stagger,
  } = options;
  const document = element.ownerDocument;
  const root = document.documentElement;
  const baseBounds = element.getBoundingClientRect();
  const media = element.querySelector<HTMLElement>(".zoterofigure-card-image");
  if (!media) throw new Error("Pinned card image container is missing");
  const initialCardSize: Size = {
    height: baseBounds.height,
    width: baseBounds.width,
  };
  const baseCardWidth = element.offsetWidth || initialCardSize.width;
  const getCardSize = (): Size => ({
    height: element.offsetHeight || initialCardSize.height,
    width: element.offsetWidth || initialCardSize.width,
  });
  const getCardSizeAtScale = (scale: number): Size => {
    const previousWidth = element.style.width;
    const previousLatexFontSize = element.style.getPropertyValue(
      PINNED_LATEX_FONT_SIZE_PROPERTY,
    );
    const styles = getPinnedCardRenderStyles(
      { scale, x: 0, y: 0 },
      baseCardWidth,
    );
    element.style.width = styles.width;
    element.style.setProperty(
      PINNED_LATEX_FONT_SIZE_PROPERTY,
      styles.latexFontSize,
    );
    const size = getCardSize();
    element.style.width = previousWidth;
    if (previousLatexFontSize) {
      element.style.setProperty(
        PINNED_LATEX_FONT_SIZE_PROPERTY,
        previousLatexFontSize,
      );
    } else {
      element.style.removeProperty(PINNED_LATEX_FONT_SIZE_PROPERTY);
    }
    return size;
  };
  const clampTransform = (value: PinnedCardTransform): PinnedCardTransform => {
    const clamped = clampPinnedCardTransform(
      { ...value, scale: 1 },
      getCardSizeAtScale(value.scale),
      getDocumentViewportSize(document),
      CARD_MARGIN,
    );
    return { ...clamped, scale: value.scale };
  };
  const initialPosition: Point = {
    x: sourceGeometry.right + CARD_MARGIN + stagger,
    y: sourceGeometry.top + stagger,
  };
  let transform = clampTransform({ scale: 1, ...initialPosition });
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
    const styles = getPinnedCardRenderStyles(value, baseCardWidth);
    element.style.transform = styles.transform;
    element.style.width = styles.width;
    element.style.setProperty(
      PINNED_LATEX_FONT_SIZE_PROPERTY,
      styles.latexFontSize,
    );
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
          ZOOM_TIME_CONSTANT_MS,
        ),
      );
      const settled = transformsAreClose(renderedTransform, transform);
      if (settled) renderedTransform = { ...transform };
      renderTransform(renderedTransform);
      if (!settled) transformFrameID = requestAnimationFrame(step);
      else previousTransformFrameTime = undefined;
    };
    transformFrameID = requestAnimationFrame(step);
  };
  const updateClampedTransform = (): void => {
    transform = clampTransform(transform);
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
    onActivate();
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
    if (!dragMoved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
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
        ownerWindow.clearTimeout(suppressClickTimerID);
      }
      suppressClickTimerID = ownerWindow.setTimeout(() => {
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
    onActivate();
    const boundedDelta = Math.max(
      -MAX_WHEEL_DELTA,
      Math.min(MAX_WHEEL_DELTA, normalizeWheelDelta(event, root.clientHeight)),
    );
    const nextScale = Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        transform.scale * Math.exp(-boundedDelta * WHEEL_SENSITIVITY),
      ),
    );
    const elementBounds = element.getBoundingClientRect();
    const mediaBounds = media.getBoundingClientRect();
    transform = zoomPinnedCardAtPoint(transform, nextScale, {
      x: event.clientX - (mediaBounds.left - elementBounds.left),
      y: event.clientY - (mediaBounds.top - elementBounds.top),
    });
    animateToClampedTransform();
  };
  const handleDoubleClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest("button, a, input, select, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const view = document.defaultView;
  const snapshots = new PinnedCardSnapshotSlot(releaseImageURL);

  element.addEventListener("click", handleClickCapture, true);
  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", stopDragging);
  element.addEventListener("pointercancel", stopDragging);
  element.addEventListener("lostpointercapture", stopDragging);
  media.addEventListener("wheel", handleWheel, { passive: false });
  element.addEventListener("dblclick", handleDoubleClick);
  element.addEventListener("keydown", handleKeyDown);
  view?.addEventListener("resize", clampToViewport);
  applyTransformImmediately();

  let disposed = false;
  return {
    cancelPendingSnapshotRefresh: () => snapshots.cancelPendingRefresh(),
    element,
    refreshSnapshot: (prepare) => snapshots.refresh(prepare),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (suppressClickTimerID !== undefined) {
        ownerWindow.clearTimeout(suppressClickTimerID);
      }
      cancelTransformAnimation();
      view?.removeEventListener("resize", clampToViewport);
      element.remove();
      snapshots.dispose();
    },
  };
}

function getDocumentViewportSize(document: Document): Size {
  return {
    height: document.documentElement.clientHeight,
    width: document.documentElement.clientWidth,
  };
}

function transformsAreClose(
  current: PinnedCardTransform,
  target: PinnedCardTransform,
): boolean {
  return (
    Math.abs(current.x - target.x) <= POSITION_EPSILON &&
    Math.abs(current.y - target.y) <= POSITION_EPSILON &&
    Math.abs(current.scale - target.scale) <= SCALE_EPSILON
  );
}

function normalizeWheelDelta(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}
