import type { FigureGalleryEntry } from "../../domain/figureGallery";
import type { FigureResultKind } from "../../domain/figureResults";

export type CountedGalleryFilterOption = readonly [
  value: string,
  label: string,
  count: number,
];

export interface GalleryFilterOptions {
  collections: CountedGalleryFilterOption[];
  documents: CountedGalleryFilterOption[];
  kinds: CountedGalleryFilterOption[];
  years: CountedGalleryFilterOption[];
}

export interface GalleryFilterValues {
  collectionID: string;
  documentID: string;
  keyword: string;
  kind: string;
  year: string;
}

type RawFilterOption = readonly [value: string, label: string | undefined];

export function buildGalleryFilterOptions(
  entries: readonly FigureGalleryEntry[],
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): GalleryFilterOptions {
  const documents = countOptions(entries, (entry) => [
    [String(entry.documentItemID), entry.documentTitle],
  ]);
  const collections = countOptions(entries, (entry) =>
    entry.collectionIDs.map(
      (id, index): RawFilterOption => [
        String(id),
        entry.collectionNames[index],
      ],
    ),
  );
  const years = countOptions(entries, (entry) =>
    entry.year ? [[entry.year, entry.year]] : [],
  ).sort((first, second) => second[0].localeCompare(first[0]));
  const kinds = countOptions(entries, (entry) => [
    [entry.kind, kindLabels[entry.kind]],
  ]);
  return { collections, documents, kinds, years };
}

export function filterGalleryEntries(
  entries: readonly FigureGalleryEntry[],
  filters: Readonly<GalleryFilterValues>,
): FigureGalleryEntry[] {
  return entries.filter((entry) => {
    if (
      filters.documentID &&
      String(entry.documentItemID) !== filters.documentID
    ) {
      return false;
    }
    if (filters.year && entry.year !== filters.year) return false;
    if (
      filters.collectionID &&
      !entry.collectionIDs.some((id) => String(id) === filters.collectionID)
    ) {
      return false;
    }
    if (filters.kind && entry.kind !== filters.kind) return false;
    return matchesGalleryKeyword(entry, filters.keyword);
  });
}

export function matchesGalleryKeyword(
  entry: FigureGalleryEntry,
  keyword: string,
): boolean {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  if (!normalizedKeyword) return true;
  return [entry.comment, entry.tag, entry.documentTitle]
    .join("\n")
    .toLocaleLowerCase()
    .includes(normalizedKeyword);
}

export function formatGalleryOptionLabel(label: string, count: number): string {
  return `${label} (${count})`;
}

function countOptions(
  entries: readonly FigureGalleryEntry[],
  getOptions: (entry: FigureGalleryEntry) => readonly RawFilterOption[],
): CountedGalleryFilterOption[] {
  const values = new Map<string, { count: number; label: string }>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const [value, label] of getOptions(entry)) {
      if (!value || !label || seen.has(value)) continue;
      seen.add(value);
      const existing = values.get(value);
      values.set(value, {
        count: (existing?.count ?? 0) + 1,
        label: existing?.label ?? label,
      });
    }
  }
  return Array.from(
    values,
    ([value, { count, label }]): CountedGalleryFilterOption => [
      value,
      label,
      count,
    ],
  ).sort((first, second) => first[1].localeCompare(second[1]));
}
