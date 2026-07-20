import {
  parseFigureGalleryComparisonLayout,
  type FigureGalleryComparisonLayout,
  type FigureGalleryViewMode,
} from "../../domain/figureGallery";
import { getPref, setPref } from "../../utils/prefs";

type StoredComparisonLayouts = Record<string, unknown>;

export const FIGURE_GALLERY_IMAGE_SCALE_DEFAULT = 100;
export const FIGURE_GALLERY_IMAGE_SCALE_MIN = 50;
export const FIGURE_GALLERY_IMAGE_SCALE_MAX = 200;

export function getFigureGalleryImageScale(): number {
  return normalizeImageScale(getPref("galleryImageScale"));
}

export function setFigureGalleryImageScale(value: number): void {
  setPref("galleryImageScale", normalizeImageScale(value));
}

export function getFigureGalleryViewMode(): FigureGalleryViewMode {
  return getPref("galleryViewMode") === "document-columns"
    ? "document-columns"
    : "waterfall";
}

export function setFigureGalleryViewMode(mode: FigureGalleryViewMode): void {
  setPref("galleryViewMode", mode);
}

export function getFigureGalleryComparisonLayout(
  libraryID: number,
): FigureGalleryComparisonLayout | undefined {
  return parseFigureGalleryComparisonLayout(readLayouts()[String(libraryID)]);
}

export function setFigureGalleryComparisonLayout(
  libraryID: number,
  layout: Readonly<FigureGalleryComparisonLayout>,
): void {
  const layouts = readLayouts();
  layouts[String(libraryID)] = layout;
  setPref("galleryComparisonLayouts", JSON.stringify(layouts));
}

function readLayouts(): StoredComparisonLayouts {
  const serialized = getPref("galleryComparisonLayouts");
  if (!serialized) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeImageScale(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return FIGURE_GALLERY_IMAGE_SCALE_DEFAULT;
  return Math.min(
    FIGURE_GALLERY_IMAGE_SCALE_MAX,
    Math.max(FIGURE_GALLERY_IMAGE_SCALE_MIN, Math.round(numeric)),
  );
}
