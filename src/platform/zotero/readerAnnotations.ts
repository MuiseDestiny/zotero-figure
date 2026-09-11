import {
  getGeneratedAnnotationKind,
  isGeneratedResultAnnotationData,
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

/** Read Zotero's cached PNG for an image annotation when available. */
export async function readReaderAnnotationCacheImage(
  libraryID: number,
  annotationKey: string,
): Promise<ArrayBuffer | undefined> {
  try {
    const annotation = await Zotero.Items.getByLibraryAndKeyAsync(
      libraryID,
      annotationKey,
    );
    if (!annotation || !annotation.isAnnotation()) {
      return undefined;
    }
    const api = Zotero.Annotations as unknown as {
      getCacheImagePath?: (item: Zotero.Item) => string | undefined;
      hasCacheImage?: (item: Zotero.Item) => Promise<boolean>;
    };
    if (!(await api.hasCacheImage?.(annotation))) return undefined;
    const path = api.getCacheImagePath?.(annotation);
    if (!path || !(await IOUtils.exists(path))) return undefined;
    const bytes = await IOUtils.read(path);
    return bytes.slice().buffer;
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}

export function getGeneratedReaderAnnotations(
  reader: PdfReader,
): ReaderAnnotationData[] {
  const generated: ReaderAnnotationData[] = [];
  for (const annotation of getReaderAnnotations(reader)) {
    if (isGeneratedResultAnnotationData(annotation)) generated.push(annotation);
  }
  return generated;
}

export function getReaderAnnotationKind(
  annotation: ReaderAnnotationData,
): "figure" | "formula" | "table" | undefined {
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
