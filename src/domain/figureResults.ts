import type { AnnotationCandidate, Rect } from "./layout";

export type FigureResultKind = "figure" | "formula" | "table";

export type DuplicateMode = "replace-page" | "skip-existing";

export interface FigureResultAnalysisIdentity {
  analysisVersion: number;
  modelHash: string;
  previewVersion: string;
}

export interface FigureResultRecord {
  comment: string;
  detectedComment?: string;
  detectedRect?: Rect;
  id: string;
  imageFile: string;
  kind: FigureResultKind;
  pageIndex: number;
  pageLabel: string;
  rect: Rect;
  tag: string;
}

export interface FigureResultCandidate extends AnnotationCandidate {
  image: ArrayBuffer;
}

export function getFigureResultKind(tag: string): FigureResultKind {
  if (/^Table(?:\s|$)/.test(tag)) return "table";
  return /^Formula(?:\s|$)/.test(tag) ? "formula" : "figure";
}

export function getFigureResultFingerprint(
  value: Pick<FigureResultRecord, "comment" | "pageIndex" | "rect" | "tag"> &
    Partial<Pick<FigureResultRecord, "detectedComment" | "detectedRect">>,
): string {
  const detectedComment = value.detectedComment ?? value.comment;
  const detectedRect = value.detectedRect ?? value.rect;
  return [
    value.pageIndex,
    detectedRect.map((coordinate) => coordinate.toFixed(1)).join(","),
    value.tag.trim(),
    detectedComment.trim(),
  ].join("|");
}

export function getFigureResultImageFingerprint(
  value: Pick<FigureResultRecord, "comment" | "pageIndex" | "rect" | "tag"> &
    Partial<Pick<FigureResultRecord, "detectedComment" | "detectedRect">>,
): string {
  return [
    getFigureResultFingerprint(value),
    value.rect.map((coordinate) => coordinate.toFixed(1)).join(","),
  ].join("|");
}

export function getFigureResultID(candidate: AnnotationCandidate): string {
  const fingerprint = getFigureResultFingerprint({
    comment: candidate.comment,
    pageIndex: candidate.pageIndex,
    rect: candidate.rect,
    tag: candidate.tag,
  });
  return `${candidate.pageIndex + 1}-${hashString(fingerprint)}`;
}

export function createFigureResultRecord(
  candidate: AnnotationCandidate,
  imageFile: string,
): FigureResultRecord {
  return {
    comment: candidate.comment,
    id: getFigureResultID(candidate),
    imageFile,
    kind: getFigureResultKind(candidate.tag),
    pageIndex: candidate.pageIndex,
    pageLabel: String(candidate.pageIndex + 1),
    rect: candidate.rect,
    tag: candidate.tag,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
