import type { AnnotationCandidate, Rect } from "./layout";

export type FigureResultKind = "figure" | "table";

export interface FigureResultAnalysisIdentity {
  analysisVersion: number;
  modelHash: string;
  previewVersion: string;
}

export interface FigureResultRecord {
  comment: string;
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
  return /^Table(?:\s|$)/.test(tag) ? "table" : "figure";
}

export function getFigureResultFingerprint(
  value: Pick<FigureResultRecord, "comment" | "pageIndex" | "rect" | "tag">,
): string {
  return [
    value.pageIndex,
    value.rect.map((coordinate) => coordinate.toFixed(1)).join(","),
    value.tag.trim(),
    value.comment.trim(),
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
