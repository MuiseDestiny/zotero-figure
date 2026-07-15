export type LayoutElementType =
  | "figure"
  | "figure_caption"
  | "table"
  | "table_caption"
  | "table_footnote"
  | "isolate_formula"
  | "formula_caption"
  | string;

export type Rect = [number, number, number, number];

export interface PdfCharacter {
  c: string;
  rect: Rect;
  lineBreakAfter?: boolean;
  spaceAfter?: boolean;
}

export interface LayoutElement {
  score: number;
  type: LayoutElementType;
  xyxy: Rect;
}

export interface PageLayoutData {
  chars: PdfCharacter[];
  elements: LayoutElement[];
  height: number;
  pageIndex: number;
  viewBox: Rect;
  width: number;
}

export interface AnnotationCandidate {
  comment: string;
  pageIndex: number;
  rect: Rect;
  tag: string;
}

interface Caption {
  bottom: number;
  left: number;
  number: string;
  right: number;
  text: string;
  top: number;
}

const LATIN_PAGE_HINT =
  /(?:^|[^a-z0-9_])(?:fig(?:ure)?s?|tables?|charts?|schemes?|equations?|eqs?|formulae?|figura|figure|tabella|tabelle|grafico|grafici|schema|schemi|equazione|equazioni)(?:$|[^a-z0-9_])/i;
const RUSSIAN_PAGE_HINT =
  /(?:^|[^а-яё0-9_])(?:рис(?:\.|унок|унка|унки)?|табл(?:\.|ица|ицы)?|график(?:а|и)?|схем(?:а|ы)|формул(?:а|ы)|уравнен(?:ие|ия))(?:$|[^а-яё0-9_])/i;
const CHINESE_NUMBER = "[0-9一二三四五六七八九十百零〇]+";
const CHINESE_PAGE_HINT = new RegExp(
  `(?:图|表|式)\\s*${CHINESE_NUMBER}|(?:上|下|本|该|如(?:下)?)\\s*(?:图|表|式)|图\\s*(?:中|示)|表\\s*中|公式|方程`,
  "i",
);
const MATHEMATICAL_PAGE_HINT = /[=∑∫√±≤≥≈≠]/;
const CAPTION_PADDING = 5;
const MAX_CAPTION_DISTANCE_RATIO = 0.3;
const MAX_FOOTNOTE_DISTANCE_RATIO = 0.2;
const MAX_FORMULA_CAPTION_DISTANCE_RATIO = 0.25;

export function charsToText(chars: readonly PdfCharacter[]): string {
  const text: string[] = [];
  for (const char of chars) {
    text.push(char.c);
    if (
      (char.spaceAfter || char.lineBreakAfter) &&
      char !== chars[chars.length - 1] &&
      !text[text.length - 1].endsWith("-")
    ) {
      text.push(" ");
    }
  }
  return text.join("");
}

export function pageMayContainFigures(chars: readonly PdfCharacter[]): boolean {
  const pageText = charsToText(chars).toLocaleLowerCase();
  // Image-only and failed-text-extraction pages must still reach the model.
  if (!pageText.trim()) return true;
  return (
    LATIN_PAGE_HINT.test(pageText) ||
    RUSSIAN_PAGE_HINT.test(pageText) ||
    CHINESE_PAGE_HINT.test(pageText) ||
    MATHEMATICAL_PAGE_HINT.test(pageText)
  );
}

export function buildAnnotationCandidates(
  page: PageLayoutData,
): AnnotationCandidate[] {
  const candidates: AnnotationCandidate[] = [];
  for (const subjectType of ["figure", "table"] as const) {
    candidates.push(...matchSubjectType(page, subjectType));
  }
  candidates.push(...matchFormulae(page));
  return candidates;
}

function matchSubjectType(
  page: PageLayoutData,
  subjectType: "figure" | "table",
): AnnotationCandidate[] {
  const captions = collectCaptions(page, `${subjectType}_caption`);
  const footnotes =
    subjectType === "table" ? collectTextRegions(page, "table_footnote") : [];
  const usedCaptions = new Set<number>();
  const usedFootnotes = new Set<number>();
  const candidates: AnnotationCandidate[] = [];

  for (const element of page.elements) {
    if (element.type !== subjectType) continue;

    const subject = toPdfRect(element.xyxy, page.width, page.height);
    const captionIndex = findClosestCaption(
      subject,
      captions,
      usedCaptions,
      subjectType,
      page.height,
    );
    if (captionIndex === undefined) continue;

    const caption = captions[captionIndex];
    const [xMin, yMin] = page.viewBox;
    let crop = subject;
    let comment = caption.text;
    if (subjectType === "table") {
      const footnoteIndex = findClosestRegionBelow(
        subject,
        footnotes,
        usedFootnotes,
        page.height,
      );
      if (footnoteIndex !== undefined) {
        const footnote = footnotes[footnoteIndex];
        usedFootnotes.add(footnoteIndex);
        crop = unionRects(crop, footnote);
        comment = [comment, footnote.text].filter(Boolean).join("\n\n");
      }
    }
    const rect: Rect = [
      roundCoordinate(crop[0] + xMin),
      roundCoordinate(crop[1] + yMin),
      roundCoordinate(crop[2] + xMin),
      roundCoordinate(crop[3] + yMin),
    ];

    if (!comment && rect[2] - rect[0] < 30) continue;

    usedCaptions.add(captionIndex);
    candidates.push({
      comment,
      pageIndex: page.pageIndex,
      rect,
      tag: `${capitalize(subjectType)} ${caption.number}`.trim(),
    });
  }

  return candidates;
}

function matchFormulae(page: PageLayoutData): AnnotationCandidate[] {
  const captions = collectCaptions(page, "formula_caption");
  const usedCaptions = new Set<number>();
  const candidates: AnnotationCandidate[] = [];

  for (const element of page.elements) {
    if (element.type !== "isolate_formula") continue;
    const subject = toPdfRect(element.xyxy, page.width, page.height);
    const captionIndex = findClosestFormulaCaption(
      subject,
      captions,
      usedCaptions,
      page.width,
    );
    const caption =
      captionIndex === undefined ? undefined : captions[captionIndex];
    if (captionIndex !== undefined) usedCaptions.add(captionIndex);
    const crop = caption ? unionRects(subject, caption) : subject;
    const [xMin, yMin] = page.viewBox;
    candidates.push({
      comment: caption?.text ?? "",
      pageIndex: page.pageIndex,
      rect: [
        roundCoordinate(crop[0] + xMin),
        roundCoordinate(crop[1] + yMin),
        roundCoordinate(crop[2] + xMin),
        roundCoordinate(crop[3] + yMin),
      ],
      tag: `Formula ${caption?.number ?? ""}`.trim(),
    });
  }
  return candidates;
}

function collectCaptions(
  page: PageLayoutData,
  captionType: "figure_caption" | "formula_caption" | "table_caption",
): Caption[] {
  return collectTextRegions(page, captionType);
}

function collectTextRegions(
  page: PageLayoutData,
  regionType:
    | "figure_caption"
    | "formula_caption"
    | "table_caption"
    | "table_footnote",
): Caption[] {
  return page.elements
    .filter((element) => element.type === regionType)
    .map((element) => {
      const [left, bottom, right, top] = toPdfRect(
        element.xyxy,
        page.width,
        page.height,
      );
      const chars = page.chars.filter((char) =>
        isCharacterCenteredInRect(char, [left, bottom, right, top]),
      );
      const text = charsToText(chars);
      return {
        bottom,
        left,
        number: text.match(/\d+/)?.[0] ?? "",
        right,
        text,
        top,
      };
    });
}

function findClosestRegionBelow(
  subject: Rect,
  regions: readonly Caption[],
  usedRegions: ReadonlySet<number>,
  pageHeight: number,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  regions.forEach((region, index) => {
    if (usedRegions.has(index)) return;
    const horizontalOverlap =
      Math.min(subject[2], region.right) - Math.max(subject[0], region.left);
    if (horizontalOverlap <= 0 || subject[1] + CAPTION_PADDING < region.top) {
      return;
    }
    const distance = subject[1] - region.top;
    if (
      distance > pageHeight * MAX_FOOTNOTE_DISTANCE_RATIO ||
      distance >= closestDistance
    ) {
      return;
    }
    closestDistance = distance;
    closestIndex = index;
  });
  return closestIndex;
}

function findClosestFormulaCaption(
  subject: Rect,
  captions: readonly Caption[],
  usedCaptions: ReadonlySet<number>,
  pageWidth: number,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  captions.forEach((caption, index) => {
    if (usedCaptions.has(index)) return;
    const verticalGap = Math.max(
      0,
      caption.bottom - subject[3],
      subject[1] - caption.top,
    );
    const subjectHeight = subject[3] - subject[1];
    const captionHeight = caption.top - caption.bottom;
    if (
      verticalGap >
      Math.max(subjectHeight, captionHeight) + CAPTION_PADDING
    ) {
      return;
    }
    const horizontalGap = Math.max(
      0,
      caption.left - subject[2],
      subject[0] - caption.right,
    );
    if (
      horizontalGap > pageWidth * MAX_FORMULA_CAPTION_DISTANCE_RATIO ||
      horizontalGap >= closestDistance
    ) {
      return;
    }
    closestDistance = horizontalGap;
    closestIndex = index;
  });
  return closestIndex;
}

function unionRects(first: Rect, second: Caption | Rect): Rect {
  const rect: Rect = Array.isArray(second)
    ? second
    : [second.left, second.bottom, second.right, second.top];
  return [
    Math.min(first[0], rect[0]),
    Math.min(first[1], rect[1]),
    Math.max(first[2], rect[2]),
    Math.max(first[3], rect[3]),
  ];
}

function isCharacterCenteredInRect(char: PdfCharacter, rect: Rect): boolean {
  const [left, bottom, right, top] = rect;
  const centerX = (char.rect[0] + char.rect[2]) / 2;
  const centerY = (char.rect[1] + char.rect[3]) / 2;
  return (
    centerX >= left - CAPTION_PADDING &&
    centerX <= right + CAPTION_PADDING &&
    centerY >= bottom - CAPTION_PADDING &&
    centerY <= top + CAPTION_PADDING
  );
}

function findClosestCaption(
  subject: Rect,
  captions: readonly Caption[],
  usedCaptions: ReadonlySet<number>,
  subjectType: "figure" | "table",
  pageHeight: number,
): number | undefined {
  let closestIndex: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  captions.forEach((caption, index) => {
    if (usedCaptions.has(index)) return;

    const horizontalOverlap =
      Math.min(subject[2], caption.right) - Math.max(subject[0], caption.left);
    if (horizontalOverlap <= 0) return;

    const distance = getCaptionDistance(subject, caption, subjectType);
    if (
      distance === undefined ||
      Math.abs(distance) > pageHeight * MAX_CAPTION_DISTANCE_RATIO
    ) {
      return;
    }

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function getCaptionDistance(
  subject: Rect,
  caption: Caption,
  subjectType: "figure" | "table",
): number | undefined {
  const [, subjectBottom, , subjectTop] = subject;
  if (subjectType === "figure") {
    if (subjectBottom + CAPTION_PADDING < caption.top) return undefined;
    return subjectBottom - caption.top;
  }

  if (subjectTop - CAPTION_PADDING > caption.bottom) return undefined;
  return caption.bottom - subjectTop;
}

function toPdfRect(normalizedRect: Rect, width: number, height: number): Rect {
  return [
    normalizedRect[0] * width,
    (1 - normalizedRect[3]) * height,
    normalizedRect[2] * width,
    (1 - normalizedRect[1]) * height,
  ];
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
