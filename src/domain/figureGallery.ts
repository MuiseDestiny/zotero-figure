import type { FigureResultKind } from "./figureResults";
import type { Rect } from "./layout";

export interface FigureGalleryLibrary {
  id: number;
  name: string;
}

export interface FigureGalleryEntry {
  attachmentID: number;
  collectionIDs: number[];
  collectionNames: string[];
  comment: string;
  documentItemID: number;
  documentTitle: string;
  id: string;
  kind: FigureResultKind;
  latex?: string;
  libraryID: number;
  pageIndex: number;
  pageLabel: string;
  rect: Rect;
  tag: string;
  year: string;
}

export interface FigureGallerySnapshot {
  entries: FigureGalleryEntry[];
  generatedAt: string;
  libraryID: number;
}

export interface FigureGalleryImage {
  base64: string;
  mimeType: "image/png";
}

export interface FigureGalleryBootstrap {
  defaultLibraryID: number;
  libraries: FigureGalleryLibrary[];
}

export type FigureGalleryViewMode = "waterfall" | "document-columns";

export interface FigureGalleryComparisonCell {
  entryIDs: string[];
  primaryEntryID: string;
}

export interface FigureGalleryComparisonRow {
  entries: Record<string, FigureGalleryComparisonCell>;
  id: string;
  isGroup: boolean;
  label: string;
}

export interface FigureGalleryComparisonLayout {
  documentOrder: number[];
  rows: FigureGalleryComparisonRow[];
  version: 3;
}

export const FIGURE_GALLERY_COMPARISON_LAYOUT_VERSION = 3;

export function extractFigureGalleryYear(date: string): string {
  return date.match(/(?:^|\D)((?:1[5-9]|20|21)\d{2})(?=\D|$)/)?.[1] ?? "";
}

export function getFigureGalleryImageAspectRatio(
  rect: Readonly<Rect>,
): number | undefined {
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return width / height;
}

export function getFigureGalleryColumnCount(
  availableWidth: number,
  minimumColumnWidth: number,
  gap: number,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  if (!Number.isFinite(minimumColumnWidth) || minimumColumnWidth <= 0) return 1;
  const safeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  return Math.max(
    1,
    Math.floor((availableWidth + safeGap) / (minimumColumnWidth + safeGap)),
  );
}

export function findShortestFigureGalleryColumn(
  heights: readonly number[],
): number {
  let shortestIndex = 0;
  let shortestHeight = Number.POSITIVE_INFINITY;
  for (let index = 0; index < heights.length; index++) {
    const height = Number.isFinite(heights[index])
      ? Math.max(0, heights[index])
      : Number.POSITIVE_INFINITY;
    if (height >= shortestHeight) continue;
    shortestHeight = height;
    shortestIndex = index;
  }
  return shortestIndex;
}

export function parseFigureGalleryComparisonLayout(
  value: unknown,
): FigureGalleryComparisonLayout | undefined {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.documentOrder) || !Array.isArray(value.rows)) {
    return undefined;
  }
  const documentOrder = value.documentOrder.filter(
    (documentID): documentID is number =>
      typeof documentID === "number" && Number.isInteger(documentID),
  );
  const rows: FigureGalleryComparisonRow[] = [];
  for (const candidate of value.rows) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.label !== "string" ||
      !isRecord(candidate.entries)
    ) {
      continue;
    }
    const entries: Record<string, FigureGalleryComparisonCell> = {};
    for (const [documentID, storedCell] of Object.entries(candidate.entries)) {
      if (!/^\d+$/.test(documentID)) continue;
      const cell = parseFigureGalleryComparisonCell(storedCell, value.version);
      if (cell) entries[documentID] = cell;
    }
    const label = candidate.label.trim().slice(0, 160);
    rows.push({
      entries,
      id: candidate.id,
      isGroup: parseFigureGalleryComparisonGroup(
        candidate.isGroup,
        label,
        entries,
        value.version,
      ),
      label,
    });
  }
  return {
    documentOrder: [...new Set(documentOrder)],
    rows,
    version: FIGURE_GALLERY_COMPARISON_LAYOUT_VERSION,
  };
}

export function reconcileFigureGalleryComparisonLayout(
  entries: readonly FigureGalleryEntry[],
  stored?: Readonly<FigureGalleryComparisonLayout>,
): FigureGalleryComparisonLayout {
  const entriesByID = new Map(entries.map((entry) => [entry.id, entry]));
  const documentIDs = [
    ...new Set(entries.map(({ documentItemID }) => documentItemID)),
  ];
  const availableDocuments = new Set(documentIDs);
  const documentOrder = [
    ...(stored?.documentOrder ?? []).filter((id) => availableDocuments.has(id)),
  ];
  for (const documentID of documentIDs) {
    if (!documentOrder.includes(documentID)) documentOrder.push(documentID);
  }

  const assignedEntries = new Set<string>();
  const usedRowIDs = new Set<string>();
  const rows: FigureGalleryComparisonRow[] = [];
  for (const storedRow of stored?.rows ?? []) {
    if (!storedRow.id || usedRowIDs.has(storedRow.id)) continue;
    usedRowIDs.add(storedRow.id);
    const rowEntries: Record<string, FigureGalleryComparisonCell> = {};
    for (const [documentKey, storedCell] of Object.entries(storedRow.entries)) {
      const documentID = Number(documentKey);
      const entryIDs: string[] = [];
      for (const entryID of storedCell.entryIDs) {
        const entry = entriesByID.get(entryID);
        if (
          !entry ||
          entry.documentItemID !== documentID ||
          assignedEntries.has(entryID)
        ) {
          continue;
        }
        entryIDs.push(entryID);
        assignedEntries.add(entryID);
      }
      if (!entryIDs.length) continue;
      rowEntries[documentKey] = {
        entryIDs,
        primaryEntryID: entryIDs.includes(storedCell.primaryEntryID)
          ? storedCell.primaryEntryID
          : entryIDs[0]!,
      };
    }
    const label = storedRow.label.trim().slice(0, 160);
    const isGroup =
      storedRow.isGroup ||
      Boolean(label) ||
      Object.values(rowEntries).some(({ entryIDs }) => entryIDs.length > 1);
    if (!isGroup && !Object.keys(rowEntries).length) continue;
    rows.push({ entries: rowEntries, id: storedRow.id, isGroup, label });
  }

  const unassignedByDocument = new Map<number, FigureGalleryEntry[]>();
  for (const documentID of documentOrder) {
    unassignedByDocument.set(
      documentID,
      entries.filter(
        (entry) =>
          entry.documentItemID === documentID && !assignedEntries.has(entry.id),
      ),
    );
  }

  const appendedRowCount = Math.max(
    0,
    ...[...unassignedByDocument.values()].map((items) => items.length),
  );
  for (let index = 0; index < appendedRowCount; index++) {
    const row = createFigureGalleryComparisonRow(rows);
    for (const documentID of documentOrder) {
      const entry = unassignedByDocument.get(documentID)?.[index];
      if (entry) {
        row.entries[String(documentID)] = createFigureGalleryComparisonCell(
          entry.id,
        );
      }
    }
    rows.push(row);
  }

  return {
    documentOrder,
    rows: compactFigureGalleryComparisonRows(rows, documentOrder),
    version: FIGURE_GALLERY_COMPARISON_LAYOUT_VERSION,
  };
}

export function insertFigureGalleryComparisonRow(
  layout: Readonly<FigureGalleryComparisonLayout>,
  beforeRowID?: string,
  moving?: { documentID: number; entryID: string },
): FigureGalleryComparisonLayout {
  const next = cloneFigureGalleryComparisonLayout(layout);
  const row = createFigureGalleryComparisonRow(next.rows, moving === undefined);
  let sourceRow: FigureGalleryComparisonRow | undefined;
  if (moving) {
    const documentKey = String(moving.documentID);
    sourceRow = next.rows.find((candidate) =>
      candidate.entries[documentKey]?.entryIDs.includes(moving.entryID),
    );
    if (sourceRow) {
      removeFigureGalleryComparisonEntry(
        sourceRow,
        documentKey,
        moving.entryID,
      );
      row.entries[documentKey] = createFigureGalleryComparisonCell(
        moving.entryID,
      );
    }
  }
  const targetIndex = beforeRowID
    ? next.rows.findIndex(({ id }) => id === beforeRowID)
    : -1;
  next.rows.splice(targetIndex < 0 ? next.rows.length : targetIndex, 0, row);
  if (moving && sourceRow) {
    removeEmptyUnnamedComparisonRow(next, sourceRow);
  }
  return next;
}

export function insertFigureGalleryComparisonEntryAtRowEdge(
  layout: Readonly<FigureGalleryComparisonLayout>,
  targetRowID: string,
  edge: "before" | "after",
  moving: { documentID: number; entryID: string },
): FigureGalleryComparisonLayout {
  const targetIndex = layout.rows.findIndex(({ id }) => id === targetRowID);
  if (targetIndex < 0) return cloneFigureGalleryComparisonLayout(layout);
  const beforeRowID =
    edge === "before" ? targetRowID : layout.rows[targetIndex + 1]?.id;
  return insertFigureGalleryComparisonRow(layout, beforeRowID, moving);
}

export function reorderFigureGalleryDocuments(
  layout: Readonly<FigureGalleryComparisonLayout>,
  movingDocumentID: number,
  targetDocumentID: number,
  before: boolean,
): FigureGalleryComparisonLayout {
  const next = cloneFigureGalleryComparisonLayout(layout);
  if (movingDocumentID === targetDocumentID) return next;
  const movingIndex = next.documentOrder.indexOf(movingDocumentID);
  const targetIndex = next.documentOrder.indexOf(targetDocumentID);
  if (movingIndex < 0 || targetIndex < 0) return next;
  next.documentOrder.splice(movingIndex, 1);
  const adjustedTargetIndex = next.documentOrder.indexOf(targetDocumentID);
  next.documentOrder.splice(
    adjustedTargetIndex + (before ? 0 : 1),
    0,
    movingDocumentID,
  );
  return next;
}

export function moveFigureGalleryComparisonEntry(
  layout: Readonly<FigureGalleryComparisonLayout>,
  sourceDocumentID: number,
  sourceEntryID: string,
  targetDocumentID: number,
  targetRowID: string,
): FigureGalleryComparisonLayout {
  if (sourceDocumentID !== targetDocumentID) {
    return cloneFigureGalleryComparisonLayout(layout);
  }
  const next = cloneFigureGalleryComparisonLayout(layout);
  const documentKey = String(sourceDocumentID);
  const sourceRow = next.rows.find((row) =>
    row.entries[documentKey]?.entryIDs.includes(sourceEntryID),
  );
  const targetRow = next.rows.find(({ id }) => id === targetRowID);
  if (!sourceRow || !targetRow || sourceRow === targetRow) return next;

  const targetCell = targetRow.entries[documentKey];
  if (targetCell?.entryIDs.includes(sourceEntryID)) return next;
  removeFigureGalleryComparisonEntry(sourceRow, documentKey, sourceEntryID);
  if (targetCell) {
    targetCell.entryIDs.push(sourceEntryID);
    targetRow.isGroup = true;
  } else {
    targetRow.entries[documentKey] =
      createFigureGalleryComparisonCell(sourceEntryID);
  }
  removeEmptyUnnamedComparisonRow(next, sourceRow);
  return next;
}

export function setFigureGalleryComparisonPrimaryEntry(
  layout: Readonly<FigureGalleryComparisonLayout>,
  rowID: string,
  documentID: number,
  entryID: string,
): FigureGalleryComparisonLayout {
  const next = cloneFigureGalleryComparisonLayout(layout);
  const cell = next.rows.find(({ id }) => id === rowID)?.entries[
    String(documentID)
  ];
  if (cell?.entryIDs.includes(entryID)) cell.primaryEntryID = entryID;
  return next;
}

export function dissolveFigureGalleryComparisonRow(
  layout: Readonly<FigureGalleryComparisonLayout>,
  rowID: string,
): FigureGalleryComparisonLayout {
  const next = cloneFigureGalleryComparisonLayout(layout);
  const rowIndex = next.rows.findIndex(({ id }) => id === rowID);
  if (rowIndex < 0) return next;
  const [removedRow] = next.rows.splice(rowIndex, 1);
  if (!removedRow) return next;

  const replacementCount = Math.max(
    0,
    ...Object.values(removedRow.entries).map(({ entryIDs }) => entryIDs.length),
  );
  const replacements: FigureGalleryComparisonRow[] = [];
  for (let index = 0; index < replacementCount; index++) {
    const replacement = createFigureGalleryComparisonRow(
      [...next.rows, removedRow, ...replacements],
      false,
    );
    for (const [documentKey, cell] of Object.entries(removedRow.entries)) {
      const entryID = cell.entryIDs[index];
      if (entryID) {
        replacement.entries[documentKey] =
          createFigureGalleryComparisonCell(entryID);
      }
    }
    replacements.push(replacement);
  }
  next.rows.splice(rowIndex, 0, ...replacements);
  return next;
}

export function setFigureGalleryComparisonRowLabel(
  layout: Readonly<FigureGalleryComparisonLayout>,
  rowID: string,
  label: string,
): FigureGalleryComparisonLayout {
  const next = cloneFigureGalleryComparisonLayout(layout);
  const row = next.rows.find(({ id }) => id === rowID);
  if (row) {
    row.label = label.trim().slice(0, 160);
    if (row.label) row.isGroup = true;
  }
  return next;
}

function createFigureGalleryComparisonRow(
  rows: readonly Pick<FigureGalleryComparisonRow, "id">[],
  isGroup = false,
): FigureGalleryComparisonRow {
  const usedIDs = new Set(rows.map(({ id }) => id));
  let suffix = 1;
  while (usedIDs.has(`comparison-row-${suffix}`)) suffix++;
  return {
    entries: {},
    id: `comparison-row-${suffix}`,
    isGroup,
    label: "",
  };
}

function compactFigureGalleryComparisonRows(
  rows: readonly FigureGalleryComparisonRow[],
  documentOrder: readonly number[],
): FigureGalleryComparisonRow[] {
  const compacted: FigureGalleryComparisonRow[] = [];
  let ordinaryRows: FigureGalleryComparisonRow[] = [];

  const appendOrdinaryRows = (): void => {
    if (!ordinaryRows.length) return;
    const documentKeys = documentOrder.map(String);
    const cellsByDocument = new Map(
      documentKeys.map((documentKey) => [
        documentKey,
        ordinaryRows.flatMap((row) => {
          const cell = row.entries[documentKey];
          return cell ? [cell] : [];
        }),
      ]),
    );
    const compactedRowCount = Math.max(
      0,
      ...[...cellsByDocument.values()].map((cells) => cells.length),
    );
    for (let index = 0; index < compactedRowCount; index++) {
      const sourceRow = ordinaryRows[index]!;
      const entries: Record<string, FigureGalleryComparisonCell> = {};
      for (const documentKey of documentKeys) {
        const cell = cellsByDocument.get(documentKey)?.[index];
        if (cell) entries[documentKey] = cell;
      }
      compacted.push({
        entries,
        id: sourceRow.id,
        isGroup: false,
        label: "",
      });
    }
    ordinaryRows = [];
  };

  for (const row of rows) {
    if (!row.isGroup) {
      ordinaryRows.push(row);
      continue;
    }
    appendOrdinaryRows();
    compacted.push(row);
  }
  appendOrdinaryRows();
  return compacted;
}

function createFigureGalleryComparisonCell(
  entryID: string,
): FigureGalleryComparisonCell {
  return { entryIDs: [entryID], primaryEntryID: entryID };
}

function removeFigureGalleryComparisonEntry(
  row: FigureGalleryComparisonRow,
  documentKey: string,
  entryID: string,
): boolean {
  const cell = row.entries[documentKey];
  if (!cell) return false;
  const entryIndex = cell.entryIDs.indexOf(entryID);
  if (entryIndex < 0) return false;
  cell.entryIDs.splice(entryIndex, 1);
  if (!cell.entryIDs.length) {
    delete row.entries[documentKey];
    return true;
  }
  if (cell.primaryEntryID === entryID) {
    cell.primaryEntryID =
      cell.entryIDs[Math.min(entryIndex, cell.entryIDs.length - 1)]!;
  }
  return true;
}

function removeEmptyUnnamedComparisonRow(
  layout: FigureGalleryComparisonLayout,
  row: FigureGalleryComparisonRow,
): void {
  if (row.isGroup || Object.keys(row.entries).length) return;
  const rowIndex = layout.rows.indexOf(row);
  if (rowIndex >= 0) layout.rows.splice(rowIndex, 1);
}

function cloneFigureGalleryComparisonLayout(
  layout: Readonly<FigureGalleryComparisonLayout>,
): FigureGalleryComparisonLayout {
  return {
    documentOrder: [...layout.documentOrder],
    rows: layout.rows.map((row) => ({
      entries: Object.fromEntries(
        Object.entries(row.entries).map(([documentKey, cell]) => [
          documentKey,
          {
            entryIDs: [...cell.entryIDs],
            primaryEntryID: cell.primaryEntryID,
          },
        ]),
      ),
      id: row.id,
      isGroup: row.isGroup,
      label: row.label,
    })),
    version: FIGURE_GALLERY_COMPARISON_LAYOUT_VERSION,
  };
}

function parseFigureGalleryComparisonCell(
  value: unknown,
  version: 1 | 2 | 3,
): FigureGalleryComparisonCell | undefined {
  if (version === 1) {
    return typeof value === "string" && value
      ? createFigureGalleryComparisonCell(value)
      : undefined;
  }
  if (!isRecord(value) || !Array.isArray(value.entryIDs)) {
    return undefined;
  }
  const entryIDs = [
    ...new Set(
      value.entryIDs.filter(
        (entryID): entryID is string =>
          typeof entryID === "string" && Boolean(entryID),
      ),
    ),
  ];
  if (!entryIDs.length) return undefined;
  return {
    entryIDs,
    primaryEntryID:
      typeof value.primaryEntryID === "string" &&
      entryIDs.includes(value.primaryEntryID)
        ? value.primaryEntryID
        : entryIDs[0]!,
  };
}

function parseFigureGalleryComparisonGroup(
  value: unknown,
  label: string,
  entries: Readonly<Record<string, FigureGalleryComparisonCell>>,
  version: 1 | 2 | 3,
): boolean {
  const inferred =
    Boolean(label) ||
    Object.values(entries).some(({ entryIDs }) => entryIDs.length > 1);
  if (version < 3) return inferred || Object.keys(entries).length === 0;
  if (typeof value === "boolean") return value || inferred;
  return inferred || Object.keys(entries).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
