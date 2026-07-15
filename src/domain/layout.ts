export type LayoutElementType =
  | "figure"
  | "figure_caption"
  | "table"
  | "table_caption"
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
  /(?:^|[^a-z0-9_])(?:fig(?:ure)?s?|tables?|charts?|schemes?|figura|figure|tabella|tabelle|grafico|grafici|schema|schemi)(?:$|[^a-z0-9_])/i;
const RUSSIAN_PAGE_HINT =
  /(?:^|[^а-яё0-9_])(?:рис(?:\.|унок|унка|унки)?|табл(?:\.|ица|ицы)?|график(?:а|и)?|схем(?:а|ы))(?:$|[^а-яё0-9_])/i;
const CHINESE_NUMBER = "[0-9一二三四五六七八九十百零〇]+";
const CHINESE_PAGE_HINT = new RegExp(
  `(?:图|表)\\s*${CHINESE_NUMBER}|(?:上|下|本|该|如(?:下)?)\\s*(?:图|表)|图\\s*(?:中|示)|表\\s*中`,
  "i",
);
const CAPTION_PADDING = 5;
const MAX_CAPTION_DISTANCE_RATIO = 0.3;

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
    CHINESE_PAGE_HINT.test(pageText)
  );
}

export function buildAnnotationCandidates(
  page: PageLayoutData,
): AnnotationCandidate[] {
  const candidates: AnnotationCandidate[] = [];
  for (const subjectType of ["figure", "table"] as const) {
    candidates.push(...matchSubjectType(page, subjectType));
  }
  return candidates;
}

function matchSubjectType(
  page: PageLayoutData,
  subjectType: "figure" | "table",
): AnnotationCandidate[] {
  const captions = collectCaptions(page, `${subjectType}_caption`);
  const usedCaptions = new Set<number>();
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
    const rect: Rect = [
      roundCoordinate(subject[0] + xMin),
      roundCoordinate(subject[1] + yMin),
      roundCoordinate(subject[2] + xMin),
      roundCoordinate(subject[3] + yMin),
    ];

    if (!caption.text && rect[2] - rect[0] < 30) continue;

    usedCaptions.add(captionIndex);
    candidates.push({
      comment: caption.text,
      pageIndex: page.pageIndex,
      rect,
      tag: `${capitalize(subjectType)} ${caption.number}`.trim(),
    });
  }

  return candidates;
}

function collectCaptions(
  page: PageLayoutData,
  captionType: "figure_caption" | "table_caption",
): Caption[] {
  return page.elements
    .filter((element) => element.type === captionType)
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
