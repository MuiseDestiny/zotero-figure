export type FigureSidebarFilter = "all" | "figure" | "table";

export type FigureSidebarKind = "figure" | "table";

export interface FigureSidebarItemMetadata {
  kind?: FigureSidebarKind;
  pageIndex?: number;
  tag: string;
}

export type FigureSidebarCounts = Record<FigureSidebarFilter, number>;

export function getFigureSidebarNavigationLabel(value: {
  comment?: string;
  tag: string;
}): string {
  const tag = normalizeLabel(value.tag);
  const comment = normalizeLabel(value.comment ?? "");
  if (!comment) return tag;
  if (!tag) return comment;

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
    all: items.length,
    figure: 0,
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
 * so rendering remains stable when two entries share a page and label.
 */
export function filterAndSortFigureSidebarItems<T>(
  items: readonly T[],
  filter: FigureSidebarFilter,
  getMetadata: (item: T) => FigureSidebarItemMetadata,
): T[] {
  return items
    .map((item, index) => ({ item, index, metadata: getMetadata(item) }))
    .filter(({ metadata }) => filter === "all" || metadata.kind === filter)
    .sort((first, second) => {
      const pageDifference =
        (first.metadata.pageIndex ?? 0) - (second.metadata.pageIndex ?? 0);
      if (pageDifference !== 0) return pageDifference;

      const tagDifference = first.metadata.tag.localeCompare(
        second.metadata.tag,
      );
      return tagDifference !== 0 ? tagDifference : first.index - second.index;
    })
    .map(({ item }) => item);
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
