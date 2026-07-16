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

export interface GalleryFilterTotals {
  collections: number;
  documents: number;
  kinds: number;
  years: number;
}

export interface GalleryFilterValues {
  collectionID: string;
  documentID: string;
  keyword: string;
  kind: string;
  year: string;
}

export interface GalleryFacetState extends GalleryFilterOptions {
  filters: GalleryFilterValues;
  totals: GalleryFilterTotals;
}

type RawFilterOption = readonly [value: string, label: string | undefined];

export function buildGalleryFilterOptions(
  entries: readonly FigureGalleryEntry[],
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): GalleryFilterOptions {
  return {
    collections: buildCollectionOptions(entries),
    documents: buildDocumentOptions(entries),
    kinds: buildKindOptions(entries, kindLabels),
    years: buildYearOptions(entries),
  };
}

/**
 * Builds each facet from entries matching every other active filter. Invalid
 * combinations are cleared and recomputed so the view cannot retain a select
 * value that has no matching option.
 */
export function buildGalleryFacetState(
  entries: readonly FigureGalleryEntry[],
  requestedFilters: Readonly<GalleryFilterValues>,
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): GalleryFacetState {
  let filters: GalleryFilterValues = { ...requestedFilters };
  for (let attempt = 0; attempt <= 4; attempt++) {
    const options = buildFacetOptions(entries, filters, kindLabels);
    const nextFilters = retainAvailableFilters(filters, options);
    if (galleryFiltersMatch(filters, nextFilters) || attempt === 4) {
      return { ...options, filters: nextFilters };
    }
    filters = nextFilters;
  }
  throw new Error("Gallery facet stabilization did not complete");
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

function buildFacetOptions(
  entries: readonly FigureGalleryEntry[],
  filters: Readonly<GalleryFilterValues>,
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): GalleryFilterOptions & { totals: GalleryFilterTotals } {
  const collectionEntries = filterGalleryEntries(entries, {
    ...filters,
    collectionID: "",
  });
  const documentEntries = filterGalleryEntries(entries, {
    ...filters,
    documentID: "",
  });
  const kindEntries = filterGalleryEntries(entries, { ...filters, kind: "" });
  const yearEntries = filterGalleryEntries(entries, { ...filters, year: "" });
  return {
    collections: buildCollectionOptions(collectionEntries),
    documents: buildDocumentOptions(documentEntries),
    kinds: buildKindOptions(kindEntries, kindLabels),
    totals: {
      collections: collectionEntries.length,
      documents: documentEntries.length,
      kinds: kindEntries.length,
      years: yearEntries.length,
    },
    years: buildYearOptions(yearEntries),
  };
}

function buildCollectionOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) =>
    entry.collectionIDs.map(
      (id, index): RawFilterOption => [
        String(id),
        entry.collectionNames[index],
      ],
    ),
  );
}

function buildDocumentOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) => [
    [String(entry.documentItemID), entry.documentTitle],
  ]);
}

function buildKindOptions(
  entries: readonly FigureGalleryEntry[],
  kindLabels: Readonly<Record<FigureResultKind, string>>,
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) => [
    [entry.kind, kindLabels[entry.kind]],
  ]);
}

function buildYearOptions(
  entries: readonly FigureGalleryEntry[],
): CountedGalleryFilterOption[] {
  return countOptions(entries, (entry) =>
    entry.year ? [[entry.year, entry.year]] : [],
  ).sort((first, second) => second[0].localeCompare(first[0]));
}

function retainAvailableFilters(
  filters: Readonly<GalleryFilterValues>,
  options: Readonly<GalleryFilterOptions>,
): GalleryFilterValues {
  return {
    collectionID: retainAvailableValue(
      filters.collectionID,
      options.collections,
    ),
    documentID: retainAvailableValue(filters.documentID, options.documents),
    keyword: filters.keyword,
    kind: retainAvailableValue(filters.kind, options.kinds),
    year: retainAvailableValue(filters.year, options.years),
  };
}

function retainAvailableValue(
  value: string,
  options: readonly CountedGalleryFilterOption[],
): string {
  return !value || options.some(([optionValue]) => optionValue === value)
    ? value
    : "";
}

function galleryFiltersMatch(
  first: Readonly<GalleryFilterValues>,
  second: Readonly<GalleryFilterValues>,
): boolean {
  return (
    first.collectionID === second.collectionID &&
    first.documentID === second.documentID &&
    first.keyword === second.keyword &&
    first.kind === second.kind &&
    first.year === second.year
  );
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
