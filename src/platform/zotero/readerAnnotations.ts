import {
  getGeneratedAnnotationKind,
  isGeneratedFigureAnnotationData,
} from "./annotations";
import type { PdfReader } from "./reader";

export interface ReaderAnnotationData {
  authorName?: string;
  comment?: string;
  id: string;
  image?: string;
  _hidden?: boolean;
  pageLabel?: string;
  position?: {
    pageIndex: number;
    rects?: number[][];
  };
  readOnly?: boolean;
  tags: Array<{ color?: string; name?: string; tag?: string }>;
  type: string;
}

export interface ReaderAnnotationManagerCompat {
  _annotations: ReaderAnnotationData[];
  _filter: {
    authors: string[];
    colors: string[];
    query: string;
    tags: string[];
  };
  render(): void;
}

interface ReaderImageActionsCompat {
  _onCopyImage?: (image: string) => Promise<void>;
  _onSaveImageAs?: (image: string) => Promise<void>;
}

export function getReaderAnnotationManager(
  reader: PdfReader,
): ReaderAnnotationManagerCompat {
  return reader._internalReader
    ._annotationManager as unknown as ReaderAnnotationManagerCompat;
}

export function getReaderAnnotations(
  reader: PdfReader,
): readonly ReaderAnnotationData[] {
  return Array.from(getReaderAnnotationManager(reader)._annotations);
}

export function getGeneratedReaderAnnotations(
  reader: PdfReader,
): ReaderAnnotationData[] {
  const generated: ReaderAnnotationData[] = [];
  for (const annotation of getReaderAnnotations(reader)) {
    if (isGeneratedFigureAnnotationData(annotation)) generated.push(annotation);
  }
  return generated;
}

export function getReaderAnnotationKind(
  annotation: ReaderAnnotationData,
): "figure" | "table" | undefined {
  return getGeneratedAnnotationKind(annotation);
}

export async function copyReaderAnnotationImage(
  reader: PdfReader,
  image: string,
): Promise<void> {
  const actions = reader._internalReader as unknown as ReaderImageActionsCompat;
  if (!actions._onCopyImage) {
    throw new Error("Zotero's image clipboard action is unavailable");
  }
  await actions._onCopyImage(image);
}

export async function saveReaderAnnotationImage(
  reader: PdfReader,
  image: string,
): Promise<void> {
  const actions = reader._internalReader as unknown as ReaderImageActionsCompat;
  if (!actions._onSaveImageAs) {
    throw new Error("Zotero's image save action is unavailable");
  }
  await actions._onSaveImageAs(image);
}

export async function navigateToReaderAnnotation(
  reader: PdfReader,
  annotation: ReaderAnnotationData,
): Promise<void> {
  if (!annotation.position) return;
  await reader.navigate({ position: annotation.position });
}
