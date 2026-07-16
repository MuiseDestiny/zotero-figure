import * as assert from "node:assert/strict";
import test from "node:test";
import { renderLatex } from "../src/utils/renderLatex";

test("creates KaTeX nodes through the destination document", () => {
  const fragment = {} as DocumentFragment;
  let markup = "";
  let detached = false;
  let replacement: Node | undefined;
  const range = {
    createContextualFragment(value: string) {
      markup = value;
      return fragment;
    },
    detach() {
      detached = true;
    },
    selectNodeContents(value: Node) {
      assert.equal(value, element);
    },
  } as unknown as Range;
  const element = {
    ownerDocument: { createRange: () => range },
    replaceChildren(value: Node) {
      replacement = value;
    },
  } as unknown as HTMLElement;

  renderLatex(element, "x^2");

  assert.match(markup, /class="katex"/);
  assert.match(markup, /<math/);
  assert.doesNotMatch(markup, /katex-html/);
  assert.equal(replacement, fragment);
  assert.equal(detached, true);
});
