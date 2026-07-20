export type FigureSidebarKind = "figure" | "formula" | "table";

export type FigureSidebarFilter = FigureSidebarKind;

export type FigureSidebarFilters = ReadonlySet<FigureSidebarFilter>;

export interface FigureSidebarItemMetadata {
  comment?: string;
  kind?: FigureSidebarKind;
  pageIndex?: number;
  rect?: readonly [number, number, number, number];
  tag: string;
}

export type FigureSidebarCounts = Record<FigureSidebarKind, number>;

export interface VerticalBounds {
  bottom: number;
  top: number;
}

export function isNearVerticalViewport(
  element: VerticalBounds,
  viewport: VerticalBounds,
  preloadDistance: number,
): boolean {
  const distance = Math.max(0, preloadDistance);
  return (
    element.bottom >= viewport.top - distance &&
    element.top <= viewport.bottom + distance
  );
}

export function shouldShowFigureSidebarEmptyState(
  visibleItemCount: number,
  analysisProgressVisible: boolean,
): boolean {
  return visibleItemCount === 0 && !analysisProgressVisible;
}

export function getFigureSidebarNavigationLabel(value: {
  comment?: string;
  tag: string;
}): string {
  const tag = normalizeLabel(value.tag);
  const comment = normalizeLabel(value.comment ?? "");
  if (!comment) return tag;
  if (!tag) return comment;
  if (/^Formula(?:\s|$)/i.test(tag)) return comment;

  const startsWithTag =
    comment.slice(0, tag.length).toLowerCase() === tag.toLowerCase();
  const nextCharacter = comment.slice(tag.length, tag.length + 1);
  if (
    startsWithTag &&
    (!nextCharacter || !/[\p{L}\p{N}]/u.test(nextCharacter))
  ) {
    return comment;
  }
  return `${tag} - ${comment}`;
}

export function countFigureSidebarItems<T>(
  items: readonly T[],
  getMetadata: (item: T) => FigureSidebarItemMetadata,
): FigureSidebarCounts {
  const counts: FigureSidebarCounts = {
    figure: 0,
    formula: 0,
    table: 0,
  };
  for (const item of items) {
    const kind = getMetadata(item).kind;
    if (kind) counts[kind]++;
  }
  return counts;
}

/**
 * Filters and orders sidebar entries without depending on Zotero or the DOM.
 * The original collection is never mutated, and the input order breaks ties
 * so rendering remains stable when two entries share the same position.
 */
export function filterAndSortFigureSidebarItems<T>(
  items: readonly T[],
  filters: FigureSidebarFilters,
  getMetadata: (item: T) => FigureSidebarItemMetadata,
): T[] {
  return items
    .map((item, index) => ({ item, index, metadata: getMetadata(item) }))
    .filter(
      ({ metadata }) =>
        filters.size === 0 ||
        (metadata.kind !== undefined && filters.has(metadata.kind)),
    )
    .sort((first, second) => {
      const pageDifference =
        (first.metadata.pageIndex ?? 0) - (second.metadata.pageIndex ?? 0);
      if (pageDifference !== 0) return pageDifference;

      const firstRect = first.metadata.rect;
      const secondRect = second.metadata.rect;
      if (firstRect && secondRect) {
        // Zotero PDF coordinates start at the bottom-left. A larger top edge
        // therefore appears earlier on an unrotated page.
        const topDifference = secondRect[3] - firstRect[3];
        if (topDifference !== 0) return topDifference;
        const leftDifference = firstRect[0] - secondRect[0];
        if (leftDifference !== 0) return leftDifference;
      }

      const tagDifference = first.metadata.tag.localeCompare(
        second.metadata.tag,
        undefined,
        { numeric: true },
      );
      return tagDifference !== 0 ? tagDifference : first.index - second.index;
    })
    .map(({ item }) => item);
}

export function toggleFigureSidebarFilter(
  filters: FigureSidebarFilters,
  filter: FigureSidebarFilter,
): Set<FigureSidebarFilter> {
  const next = new Set(filters);
  if (next.has(filter)) next.delete(filter);
  else next.add(filter);
  return next;
}

export function pruneUnavailableFigureSidebarFilters(
  filters: FigureSidebarFilters,
  counts: FigureSidebarCounts,
): Set<FigureSidebarFilter> {
  return new Set([...filters].filter((filter) => counts[filter] > 0));
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
