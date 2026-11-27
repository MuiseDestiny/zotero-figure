import * as assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnnotationCandidates,
  charsToText,
  matchAdjacentFigureCaption,
  matchPageLayout,
  pageMayContainFigures,
  type LayoutElement,
  type PageLayoutData,
  type PdfCharacter,
} from "../src/domain/layout";

test("reconstructs page text without inserting a space after a hyphen", () => {
  const chars: PdfCharacter[] = [
    character("multi-", [0, 0, 10, 10], true),
    character("column", [10, 0, 20, 10], true),
    character("Figure 1", [20, 0, 30, 10]),
  ];
  assert.equal(charsToText(chars), "multi-column Figure 1");
  assert.equal(pageMayContainFigures(chars), true);
  assert.equal(pageMayContainFigures([character("plain text")]), false);
});

test("page hints use complete multilingual terms instead of substrings", () => {
  for (const text of [
    "Fig. 2 Results",
    "Tabella 3",
    "Рис. 4",
    "Таблица 5",
    "结果见下图",
    "表 6 数据",
    "Equation 7",
    "公式 8",
    "x = y + 1",
  ]) {
    assert.equal(pageMayContainFigures([character(text)]), true, text);
  }
  for (const text of [
    "configuration is suitable",
    "comfortable reading",
    "这表示结果可靠",
    "普通正文",
  ]) {
    assert.equal(pageMayContainFigures([character(text)]), false, text);
  }
  assert.equal(pageMayContainFigures([]), true);
});

test("matches a figure with its caption and applies both view-box offsets", () => {
  const page = createPage({
    chars: [character("Figure 12. Result", [120, 425, 400, 475])],
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.5, 0.5] },
      {
        score: 0.9,
        type: "figure_caption",
        xyxy: [0.1, 0.52, 0.5, 0.58],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page), [
    {
      comment: "Figure 12. Result",
      pageIndex: 2,
      rect: [110, 520, 510, 920],
      tag: "Figure 12",
    },
  ]);
});

test("matches table captions above the table", () => {
  const page = createPage({
    chars: [character("Table 3", [580, 725, 850, 795])],
    elements: [
      { score: 0.8, type: "table", xyxy: [0.55, 0.3, 0.9, 0.7] },
      {
        score: 0.8,
        type: "table_caption",
        xyxy: [0.55, 0.2, 0.9, 0.28],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page)[0], {
    comment: "Table 3",
    pageIndex: 2,
    rect: [560, 320, 910, 720],
    tag: "Table 3",
  });
});

test("includes the nearest table footnote in its text and crop", () => {
  const page = createPage({
    chars: [
      character("Table 4. Values", [110, 730, 700, 790]),
      character("* p < 0.05", [110, 225, 700, 275]),
    ],
    elements: [
      { score: 0.9, type: "table", xyxy: [0.1, 0.3, 0.9, 0.7] },
      {
        score: 0.9,
        type: "table_caption",
        xyxy: [0.1, 0.2, 0.9, 0.28],
      },
      {
        score: 0.85,
        type: "table_footnote",
        xyxy: [0.1, 0.72, 0.9, 0.78],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page)[0], {
    comment: "Table 4. Values\n\n* p < 0.05",
    pageIndex: 2,
    rect: [110, 240, 910, 720],
    tag: "Table 4",
  });
});

test("matches formula numbers and keeps unnumbered isolated formulae", () => {
  const page = createPage({
    chars: [character("(7)", [805, 525, 855, 575])],
    elements: [
      {
        score: 0.9,
        type: "isolate_formula",
        xyxy: [0.2, 0.4, 0.75, 0.5],
      },
      {
        score: 0.8,
        type: "formula_caption",
        xyxy: [0.8, 0.42, 0.86, 0.48],
      },
      {
        score: 0.85,
        type: "isolate_formula",
        xyxy: [0.25, 0.65, 0.7, 0.72],
      },
    ],
  });

  assert.deepEqual(buildAnnotationCandidates(page), [
    {
      comment: "(7)",
      pageIndex: 2,
      rect: [210, 520, 870, 620],
      tag: "Formula 7",
    },
    {
      comment: "",
      pageIndex: 2,
      rect: [260, 300, 710, 370],
      tag: "Formula",
    },
  ]);
});

test("does not reuse one caption for multiple detected subjects", () => {
  const page = createPage({
    chars: [character("Figure 1", [100, 425, 500, 475])],
    elements: [
      { score: 0.9, type: "figure", xyxy: [0.1, 0.1, 0.3, 0.5] },
      { score: 0.8, type: "figure", xyxy: [0.3, 0.1, 0.5, 0.5] },
      {
        score: 0.9,
        type: "figure_caption",
        xyxy: [0.1, 0.52, 0.5, 0.58],
      },
    ],
  });
  assert.equal(buildAnnotationCandidates(page).length, 1);
});

test("cross-page matching accepts a figure-sized crop and an aligned numbered caption", () => {
  const figurePage = createPage({ elements: [fullPageFigure] });
  const captionPage = createPage({
    elements: [topCaption],
    chars: [character("Fig. 12. Two-column legend", [110, 860, 430, 920])],
  });
  assert.deepEqual(
    matchAdjacentFigureCaption(
      figurePage.pageIndex,
      matchPageLayout(figurePage).figureForNextCaption,
      matchPageLayout(captionPage).captionForPreviousFigure,
    ),
    {
      pageIndex: 2,
      rect: [110, 120, 910, 920],
      tag: "Figure 12",
      comment: "Fig. 12. Two-column legend",
    },
  );
});

test("cross-page matching does not export ambiguous or unnumbered captions", () => {
  const heading = character("Figure 1. Caption", [110, 860, 430, 920]);
  for (const page of [
    createPage({
      elements: [topCaption],
      chars: [character("See Figure 1 in text", heading.rect)],
    }),
    createPage({
      elements: [topCaption],
      chars: [character("Figure 1A. Panel label", heading.rect)],
    }),
    createPage({
      elements: [topCaption],
      chars: [character("Figure without a number", heading.rect)],
    }),
    createPage({ elements: [topCaption], chars: [] }),
    createPage({
      elements: [{ ...topCaption, xyxy: [0.1, 0.4, 0.45, 0.6] }],
      chars: [character(heading.c, [110, 430, 430, 580])],
    }),
    createPage({
      elements: [topCaption, { ...topCaption, xyxy: [0.55, 0.08, 0.9, 0.3] }],
      chars: [heading, character("Figure 2. Caption", [570, 860, 840, 920])],
    }),
    createPage({ elements: [topCaption, fullPageFigure], chars: [heading] }),
  ]) {
    assert.equal(matchPageLayout(page).captionForPreviousFigure, undefined);
  }
});

test("cross-page matching leaves same-page pairs, ambiguous crops and misaligned columns alone", () => {
  const bottomCaption: LayoutElement = {
    ...topCaption,
    xyxy: [0.1, 0.91, 0.9, 0.99],
  };
  const page = createPage({
    elements: [fullPageFigure, bottomCaption],
    chars: [character("Figure 1. Same-page caption", [110, 20, 800, 70])],
  });
  const matches = matchPageLayout(page);
  assert.equal(matches.candidates[0]?.tag, "Figure 1");
  assert.equal(matches.figureForNextCaption, undefined);
  assert.equal(matches.captionForPreviousFigure, undefined);
  for (const elements of [
    [
      fullPageFigure,
      { ...fullPageFigure, xyxy: [0.1, 0.15, 0.3, 0.35] } as LayoutElement,
    ],
    [{ ...fullPageFigure, score: 0.49 }],
    [{ ...fullPageFigure, xyxy: [0.1, 0.1, 0.6, 0.5] } as LayoutElement],
  ]) {
    assert.equal(
      matchPageLayout(createPage({ elements })).figureForNextCaption,
      undefined,
    );
  }
  assert.equal(
    matchAdjacentFigureCaption(
      0,
      { rect: [40, 0, 100, 100], left: 0.4, right: 1 },
      { comment: "Figure 2. Caption", number: "2", left: 0, right: 0.45 },
    ),
    undefined,
  );
});

const fullPageFigure: LayoutElement = {
  score: 0.9,
  type: "figure",
  xyxy: [0.1, 0.1, 0.9, 0.9],
};

const topCaption: LayoutElement = {
  score: 0.9,
  type: "figure_caption",
  xyxy: [0.1, 0.08, 0.45, 0.3],
};

function createPage(overrides: Partial<PageLayoutData> = {}): PageLayoutData {
  return {
    chars: [],
    elements: [],
    height: 1_000,
    pageIndex: 2,
    viewBox: [10, 20, 1_010, 1_020],
    width: 1_000,
    ...overrides,
  };
}

function character(
  c: string,
  rect: PdfCharacter["rect"] = [0, 0, 1, 1],
  spaceAfter = false,
): PdfCharacter {
  return { c, rect, spaceAfter };
}
