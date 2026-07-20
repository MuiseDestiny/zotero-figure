import * as assert from "node:assert/strict";
import test from "node:test";
import { getLatexPreviewState } from "../src/features/latex-editor/latexEditorView";

test("builds a KaTeX preview for valid formula source", () => {
  const preview = getLatexPreviewState(String.raw`\frac{x^2}{y}`);

  assert.equal(preview.kind, "valid");
  if (preview.kind === "valid") {
    assert.match(preview.markup, /<math/);
    assert.match(preview.markup, /<mfrac>/);
  }
});

test("distinguishes empty and invalid formula source", () => {
  assert.deepEqual(getLatexPreviewState("  \n "), { kind: "empty" });
  const invalid = getLatexPreviewState(String.raw`\frac{x`);

  assert.equal(invalid.kind, "invalid");
  if (invalid.kind === "invalid") assert.match(invalid.message, /KaTeX/);
});
