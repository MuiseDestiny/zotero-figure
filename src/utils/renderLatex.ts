import * as katex from "katex";

export function renderLatex(element: HTMLElement, latex: string): void {
  const markup = katex.renderToString(latex, {
    displayMode: true,
    output: "mathml",
    strict: false,
    throwOnError: false,
    trust: false,
  });
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  element.replaceChildren(range.createContextualFragment(markup));
  range.detach();
}
