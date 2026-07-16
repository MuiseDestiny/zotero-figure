import type { FigureResultKind } from "../../domain/figureResults";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type FigureSidebarIconKind =
  | FigureResultKind
  | "annotation"
  | "check"
  | "languages"
  | "loading"
  | "menu"
  | "refresh"
  | "search"
  | "trash";

export function createFigureSidebarIcon(
  document: Document,
  kind: FigureSidebarIconKind,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute(
    "viewBox",
    kind === "annotation" ? "0 0 16 16" : "0 0 24 24",
  );
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("zoterofigure-svg-icon", `zoterofigure-icon-${kind}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attributes] of getFigureSidebarIconParts(kind)) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }
  return svg;
}

export function createPluginIcon(
  document: Document,
  className?: string,
): HTMLImageElement {
  const icon = document.createElement("img");
  if (className) icon.classList.add(className);
  icon.src = __pluginIconDataURL__;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function createNativeNoteIcon(document: Document): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.classList.add("zoterofigure-native-note-icon");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute("clip-rule", "evenodd");
  path.setAttribute(
    "d",
    "M3.625 1H3V1.625V3.75V5V18.375V19H3.625H12.375H12.6339L12.8169 18.8169L17.8169 13.8169L18 13.6339V13.375V1.625V1H17.375H3.625ZM4.25 5V17.75H11.75V13.375V12.75H12.375H16.75V5H4.25ZM16.75 3.75V2.25H4.25V3.75H16.75ZM13 14H15.8661L13 16.8661V14Z",
  );
  path.setAttribute("fill", "currentColor");
  icon.append(path);
  return icon;
}

export function getFigureSidebarIconParts(
  kind: FigureSidebarIconKind,
): Array<[string, Record<string, string>]> {
  switch (kind) {
    case "annotation":
      return [
        [
          "path",
          {
            d: "M10 1H6v1h4zm2 3H4v8h8zM3 3v10h10V3zm11 11v-2h1v3h-3v-1zm1-8h-1v4h1zM1 6h1v4H1zm5 8h4v1H6zm6-12h2v2h1V1h-3zM2 2v2H1V1h3v1zm2 12H2v-2H1v3h3z",
            fill: "currentColor",
            "fill-rule": "evenodd",
            "clip-rule": "evenodd",
            stroke: "none",
          },
        ],
      ];
    case "languages":
      return [
        ["path", { d: "m5 8 6 11" }],
        ["path", { d: "m4 14 6.5-6.5" }],
        ["path", { d: "M2 5h12" }],
        ["path", { d: "M7 2h1" }],
        ["path", { d: "m22 22-5-10-5 10" }],
        ["path", { d: "M14 18h6" }],
      ];
    case "check":
      return [["path", { d: "M20 6 9 17l-5-5" }]];
    case "figure":
      return [
        [
          "rect",
          { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" },
        ],
        ["circle", { cx: "9", cy: "9", r: "2" }],
        ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
      ];
    case "formula":
      return [
        [
          "path",
          {
            d: "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2",
          },
        ],
      ];
    case "table":
      return [
        ["path", { d: "M12 3v18" }],
        ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
        ["path", { d: "M3 9h18" }],
        ["path", { d: "M3 15h18" }],
      ];
    case "menu":
      return [
        ["circle", { cx: "5", cy: "12", r: "1" }],
        ["circle", { cx: "12", cy: "12", r: "1" }],
        ["circle", { cx: "19", cy: "12", r: "1" }],
      ];
    case "loading":
      return [
        ["circle", { cx: "12", cy: "12", opacity: "0.25", r: "9" }],
        ["path", { d: "M21 12a9 9 0 0 0-9-9" }],
      ];
    case "refresh":
      return [
        [
          "path",
          {
            d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
          },
        ],
        ["path", { d: "M3 3v5h5" }],
      ];
    case "search":
      return [
        ["circle", { cx: "11", cy: "11", r: "8" }],
        ["path", { d: "m21 21-4.3-4.3" }],
      ];
    case "trash":
      return [
        ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
        ["path", { d: "M3 6h18" }],
        ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
      ];
  }
}
