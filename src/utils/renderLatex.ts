import * as katex from "katex";

export interface RenderLatexOptions {
  throwOnError?: boolean;
}

export function renderLatexToString(
  latex: string,
  options: RenderLatexOptions = {},
): string {
  return katex.renderToString(latex, {
    displayMode: true,
    output: "mathml",
    strict: false,
    throwOnError: options.throwOnError ?? false,
    trust: false,
  });
}

export function renderLatex(
  element: HTMLElement,
  latex: string,
  options: RenderLatexOptions = {},
): void {
  const markup = renderLatexToString(latex, options);
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  element.replaceChildren(range.createContextualFragment(markup));
  range.detach();
}
