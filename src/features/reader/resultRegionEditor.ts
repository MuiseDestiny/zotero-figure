import type { Rect } from "../../domain/layout";
import {
  resizeNormalizedResultRegion,
  type ResultRegionEditMode,
} from "../../domain/resultRegion";
import { getString } from "../../utils/locale";

export interface ResultCorrectionPreview {
  detectedRect: Rect;
  imageURL: string;
  rect: Rect;
}

export interface ResultRegionDialogData {
  rect: Rect;
}

export interface ResultRegionEditorSession {
  dispose(): void;
  reset(): void;
}

export function installResultRegionEditor(
  document: Document,
  host: HTMLElement,
  preview: ResultCorrectionPreview,
  dialogData: ResultRegionDialogData,
): ResultRegionEditorSession {
  const style = document.createElement("style");
  style.textContent = `
    #zoterofigure-region-editor {
      align-items: center;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 72px);
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      padding: 8px 8px 0;
      width: calc(100vw - 24px);
    }
    #zoterofigure-region-stage {
      background: var(--material-mix-quinary);
      flex: 0 0 auto;
      line-height: 0;
      overflow: hidden;
      position: relative;
    }
    #zoterofigure-region-page {
      display: block;
      height: 100%;
      user-select: none;
      width: 100%;
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
  `;

  const stage = document.createElement("div");
  stage.id = "zoterofigure-region-stage";
  const image = document.createElement("img");
  image.id = "zoterofigure-region-page";
  image.alt = "";
  image.draggable = false;
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
  host.replaceChildren(style, stage);

  const fitPage = () => {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const availableWidth = Math.max(1, host.clientWidth - 16);
    const availableHeight = Math.max(1, host.clientHeight - 16);
    const { height, width } = getFittedResultRegionPageSize(
      image.naturalWidth,
      image.naturalHeight,
      availableWidth,
      availableHeight,
    );
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
  };
  const view = document.defaultView;
  image.addEventListener("load", fitPage);
  view?.addEventListener("resize", fitPage);
  image.src = preview.imageURL;
  if (image.complete) fitPage();

  const detectedRect = [...preview.detectedRect] as Rect;
  const render = () => {
    const [left, top, right, bottom] = dialogData.rect;
    selection.style.left = `${left * 100}%`;
    selection.style.top = `${top * 100}%`;
    selection.style.width = `${(right - left) * 100}%`;
    selection.style.height = `${(bottom - top) * 100}%`;
  };
  render();

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
    mode = isResizeHandle(handle) ? handle : "move";
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
  const finishPointerInteraction = (event: PointerEvent) => {
    if (event.pointerId !== pointerID) return;
    pointerID = undefined;
    if (selection.hasPointerCapture(event.pointerId)) {
      selection.releasePointerCapture(event.pointerId);
    }
  };
  const handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerId === pointerID) pointerID = undefined;
  };
  const handleReset = () => {
    dialogData.rect = [...detectedRect];
    render();
  };
  selection.addEventListener("pointerdown", handlePointerDown);
  selection.addEventListener("lostpointercapture", handleLostPointerCapture);
  view?.addEventListener("pointermove", handlePointerMove);
  view?.addEventListener("pointerup", finishPointerInteraction);
  view?.addEventListener("pointercancel", finishPointerInteraction);
  return {
    dispose: () => {
      selection.removeEventListener("pointerdown", handlePointerDown);
      selection.removeEventListener(
        "lostpointercapture",
        handleLostPointerCapture,
      );
      image.removeEventListener("load", fitPage);
      view?.removeEventListener("resize", fitPage);
      view?.removeEventListener("pointermove", handlePointerMove);
      view?.removeEventListener("pointerup", finishPointerInteraction);
      view?.removeEventListener("pointercancel", finishPointerInteraction);
    },
    reset: handleReset,
  };
}

export function getFittedResultRegionPageSize(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth: number,
  availableHeight: number,
): { height: number; width: number } {
  if (
    ![naturalWidth, naturalHeight, availableWidth, availableHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return { height: 1, width: 1 };
  }
  const scale = Math.min(
    availableWidth / naturalWidth,
    availableHeight / naturalHeight,
  );
  return {
    height: Math.max(1, Math.floor(naturalHeight * scale)),
    width: Math.max(1, Math.floor(naturalWidth * scale)),
  };
}

function isResizeHandle(
  value: string | undefined,
): value is ResultRegionEditMode {
  return value === "ne" || value === "nw" || value === "se" || value === "sw";
}
