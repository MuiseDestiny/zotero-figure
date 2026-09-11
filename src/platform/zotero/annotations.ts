import {
  getFigureResultKind,
  isFigureResultTag,
  type DuplicateMode,
} from "../../domain/figureResults";
import type { AnnotationCandidate, Rect } from "../../domain/layout";
import { throwIfAborted } from "../../utils/cancellation";
import type { PdfReader } from "./reader";

export const GENERATED_ANNOTATION_AUTHOR = "zoterofigure";

export interface ReconcileResult {
  created: number;
  removed: number;
  skipped: number;
}

export interface AnnotationIdentity {
  authorName?: string;
  tags?: Array<{ name?: string; tag?: string }>;
  type?: string;
}

export function getImageAnnotationCandidate(
  annotation: Zotero.Item,
): AnnotationCandidate | undefined {
  if (!annotation.isAnnotation() || annotation.annotationType !== "image") {
    return undefined;
  }
  const position = parseAnnotationPosition(annotation.annotationPosition);
  const values = position?.rects?.[0];
  if (
    !position ||
    !values ||
    values.length !== 4 ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    return undefined;
  }
  const tag = annotation
    .getTags()
    .map(({ tag }) => tag.trim())
    .find(isFigureResultTag);
  return {
    comment: annotation.annotationComment?.trim() ?? "",
    pageIndex: position.pageIndex,
    rect: values as Rect,
    tag: tag || "Figure",
  };
}

export type AnnotationTarget = PdfReader | Zotero.Item;

interface AnnotationJSON {
  authorName: string;
  color: string;
  comment: string;
  dateCreated: string;
  dateModified: string;
  id: string;
  key: string;
  pageLabel: string;
  position: {
    pageIndex: number;
    rects: Rect[];
  };
  sortIndex: string;
  text: string;
  type: "image";
}

export function isGeneratedResultAnnotation(item: Zotero.Item): boolean {
  return isGeneratedResultAnnotationData({
    authorName: item.annotationAuthorName,
    tags: item.getTags(),
    type: item.annotationType,
  });
}

export function isGeneratedResultAnnotationData(
  annotation: AnnotationIdentity,
): boolean {
  const tags = Array.from(annotation.tags ?? []);
  return (
    annotation.type === "image" &&
    annotation.authorName === GENERATED_ANNOTATION_AUTHOR &&
    tags.some((tag) => isFigureResultTag(tag.name ?? tag.tag ?? ""))
  );
}

export function getGeneratedAnnotationKind(
  annotation: AnnotationIdentity,
): "figure" | "formula" | "table" | undefined {
  let tag: string | undefined;
  for (const entry of Array.from(annotation.tags ?? [])) {
    const value = entry.name ?? entry.tag ?? "";
    if (isFigureResultTag(value)) {
      tag = value;
      break;
    }
  }
  if (!tag) return undefined;
  return getFigureResultKind(tag);
}

export function hasGeneratedResultAnnotations(item: Zotero.Item): boolean {
  return item.getAnnotations().some(isGeneratedResultAnnotation);
}

export async function saveGeneratedAnnotation(
  target: AnnotationTarget,
  candidate: AnnotationCandidate,
): Promise<Zotero.Item> {
  if (!isFigureResultTag(candidate.tag)) {
    throw new Error("Generated annotation has an invalid result tag");
  }
  const attachment = getAnnotationAttachment(target);
  const createdAt = new Date().toISOString();
  const key = Zotero.Utilities.generateObjectKey();
  const rect = candidate.rect.map((value) => Number(value.toFixed(3))) as Rect;
  const annotation: AnnotationJSON = {
    authorName: GENERATED_ANNOTATION_AUTHOR,
    color: "#d2d8e2",
    comment: candidate.comment,
    dateCreated: createdAt,
    dateModified: createdAt,
    id: key,
    key,
    pageLabel: String(candidate.pageIndex + 1),
    position: { pageIndex: candidate.pageIndex, rects: [rect] },
    sortIndex: getSortIndex(
      candidate.pageIndex,
      Math.ceil(rect[0]),
      1000 - Math.ceil(rect[1]),
    ),
    text: "",
    type: "image",
  };

  const saved = await Zotero.Annotations.saveFromJSON(
    attachment,
    annotation as unknown as _ZoteroTypes.Annotations.AnnotationJson,
  );
  try {
    saved.setTags([candidate.tag]);
    await saved.saveTx();
    return saved;
  } catch (error) {
    await rollbackCreatedAnnotations([saved]);
    throw error;
  }
}

export async function reconcileGeneratedAnnotations(
  target: AnnotationTarget,
  pageIndex: number,
  candidates: readonly AnnotationCandidate[],
  mode: DuplicateMode,
  signal?: AbortSignal,
): Promise<ReconcileResult> {
  const attachment = getAnnotationAttachment(target);
  const existing = getGeneratedAnnotationsForPage(attachment, pageIndex);
  if (mode === "skip-existing") {
    return appendMissingAnnotations(target, existing, candidates, signal);
  }

  if (annotationSetsMatch(existing, candidates)) {
    return { created: 0, removed: 0, skipped: candidates.length };
  }

  const created: Zotero.Item[] = [];
  try {
    for (const candidate of candidates) {
      throwIfAborted(signal);
      created.push(await saveGeneratedAnnotation(target, candidate));
    }
    throwIfAborted(signal);
  } catch (error) {
    await rollbackCreatedAnnotations(created);
    throw error;
  }

  try {
    await eraseAnnotations(existing);
  } catch (error) {
    await rollbackCreatedAnnotations(created);
    throw error;
  }
  return {
    created: created.length,
    removed: existing.length,
    skipped: 0,
  };
}

export async function removeGeneratedAnnotations(
  item: Zotero.Item,
): Promise<number> {
  const annotations = item.getAnnotations().filter(isGeneratedResultAnnotation);
  await eraseAnnotations(annotations);
  return annotations.length;
}

export async function removeGeneratedAnnotationForCandidate(
  item: Zotero.Item,
  candidate: AnnotationCandidate,
): Promise<boolean> {
  const fingerprint = getCandidateFingerprint(candidate, true);
  const annotation = item
    .getAnnotations(false)
    .filter(isGeneratedResultAnnotation)
    .find(
      (candidateAnnotation) =>
        getAnnotationFingerprint(candidateAnnotation, true) === fingerprint,
    );
  if (!annotation) return false;
  await annotation.eraseTx();
  return true;
}

export async function updateGeneratedAnnotationCommentForCandidate(
  item: Zotero.Item,
  candidate: AnnotationCandidate,
): Promise<boolean> {
  const fingerprint = getCandidateFingerprint(candidate, false);
  const annotation = item
    .getAnnotations(false)
    .filter(isGeneratedResultAnnotation)
    .find(
      (candidateAnnotation) =>
        getAnnotationFingerprint(candidateAnnotation, false) === fingerprint,
    );
  if (!annotation) return false;
  if (annotation.annotationComment === candidate.comment) return true;
  annotation.annotationComment = candidate.comment;
  await annotation.saveTx();
  return true;
}

export async function updateGeneratedAnnotationPositionForCandidate(
  item: Zotero.Item,
  previous: AnnotationCandidate,
  updated: AnnotationCandidate,
): Promise<boolean> {
  const fingerprint = getCandidateFingerprint(previous, false);
  const annotation = item
    .getAnnotations(false)
    .filter(isGeneratedResultAnnotation)
    .find(
      (candidateAnnotation) =>
        getAnnotationFingerprint(candidateAnnotation, false) === fingerprint,
    );
  if (!annotation) return false;
  const rect = updated.rect.map((value) => Number(value.toFixed(3))) as Rect;
  annotation.annotationPosition = JSON.stringify({
    pageIndex: updated.pageIndex,
    rects: [rect],
  });
  await annotation.saveTx();
  return true;
}

async function eraseAnnotations(annotations: Zotero.Item[]): Promise<void> {
  for (const annotation of annotations) {
    await annotation.eraseTx();
  }
}

async function rollbackCreatedAnnotations(
  annotations: readonly Zotero.Item[],
): Promise<void> {
  for (const annotation of annotations) {
    try {
      await annotation.eraseTx();
    } catch (error) {
      Zotero.logError(toError(error));
    }
  }
}

function getGeneratedAnnotationsForPage(
  item: Zotero.Item,
  pageIndex: number,
): Zotero.Item[] {
  return item
    .getAnnotations(false)
    .filter(isGeneratedResultAnnotation)
    .filter((annotation) => getAnnotationPageIndex(annotation) === pageIndex);
}

async function appendMissingAnnotations(
  target: AnnotationTarget,
  existing: readonly Zotero.Item[],
  candidates: readonly AnnotationCandidate[],
  signal?: AbortSignal,
): Promise<ReconcileResult> {
  const fingerprints = new Set(
    existing.flatMap((annotation) => {
      const fingerprint = getAnnotationFingerprint(annotation, false);
      return fingerprint ? [fingerprint] : [];
    }),
  );
  const createdAnnotations: Zotero.Item[] = [];
  let created = 0;
  let skipped = 0;
  try {
    for (const candidate of candidates) {
      throwIfAborted(signal);
      const fingerprint = getCandidateFingerprint(candidate, false);
      if (fingerprints.has(fingerprint)) {
        skipped++;
        continue;
      }
      const annotation = await saveGeneratedAnnotation(target, candidate);
      createdAnnotations.push(annotation);
      fingerprints.add(fingerprint);
      created++;
    }
    throwIfAborted(signal);
  } catch (error) {
    await rollbackCreatedAnnotations(createdAnnotations);
    throw error;
  }
  return { created, removed: 0, skipped };
}

function getAnnotationAttachment(target: AnnotationTarget): Zotero.Item {
  const readerItem = (target as Partial<PdfReader>)._item;
  return readerItem ?? (target as Zotero.Item);
}

function annotationSetsMatch(
  existing: readonly Zotero.Item[],
  candidates: readonly AnnotationCandidate[],
): boolean {
  if (existing.length !== candidates.length) return false;
  const existingFingerprints = existing
    .map((annotation) => getAnnotationFingerprint(annotation, true))
    .filter((value): value is string => Boolean(value))
    .sort();
  const candidateFingerprints = candidates
    .map((candidate) => getCandidateFingerprint(candidate, true))
    .sort();
  return (
    existingFingerprints.length === candidateFingerprints.length &&
    existingFingerprints.every(
      (fingerprint, index) => fingerprint === candidateFingerprints[index],
    )
  );
}

function getAnnotationFingerprint(
  annotation: Zotero.Item,
  includeComment: boolean,
): string | undefined {
  const position = parseAnnotationPosition(annotation.annotationPosition);
  const rect = position?.rects?.[0];
  const tag = annotation
    .getTags()
    .map(({ tag }) => tag)
    .find(isFigureResultTag);
  if (!position || !rect || !tag) return undefined;
  return buildFingerprint(
    position.pageIndex,
    rect as Rect,
    tag,
    includeComment ? annotation.annotationComment : undefined,
  );
}

function getCandidateFingerprint(
  candidate: AnnotationCandidate,
  includeComment: boolean,
): string {
  return buildFingerprint(
    candidate.pageIndex,
    candidate.rect,
    candidate.tag,
    includeComment ? candidate.comment : undefined,
  );
}

function buildFingerprint(
  pageIndex: number,
  rect: Rect,
  tag: string,
  comment?: string,
): string {
  const normalizedRect = rect.map((value) => value.toFixed(1)).join(",");
  return [pageIndex, normalizedRect, tag.trim(), comment?.trim() ?? ""].join(
    "|",
  );
}

function getAnnotationPageIndex(annotation: Zotero.Item): number | undefined {
  return parseAnnotationPosition(annotation.annotationPosition)?.pageIndex;
}

function parseAnnotationPosition(
  value: string,
): { pageIndex: number; rects?: number[][] } | undefined {
  try {
    const position = JSON.parse(value) as {
      pageIndex?: unknown;
      rects?: number[][];
    };
    return typeof position.pageIndex === "number"
      ? { pageIndex: position.pageIndex, rects: position.rects }
      : undefined;
  } catch {
    return undefined;
  }
}

function getSortIndex(pageIndex: number, offset: number, top: number): string {
  return [
    String(pageIndex).slice(0, 5).padStart(5, "0"),
    String(offset).slice(0, 6).padStart(6, "0"),
    String(Math.max(Math.floor(top), 0))
      .slice(0, 5)
      .padStart(5, "0"),
  ].join("|");
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
