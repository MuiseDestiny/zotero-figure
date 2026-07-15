import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync("addon/chrome/content/preferences.xhtml", "utf8");
const css = readFileSync("addon/chrome/content/preferences.css", "utf8");
const script = readFileSync(
  "src/features/preferences/preferenceScript.ts",
  "utf8",
);

test("keeps preferences spacious and hides the immutable model path", () => {
  const section = getRule(".preferences-section");
  const description = getRule(".section-description");
  const settingGap = getRule(".setting-block + .setting-block");

  assert.doesNotMatch(markup, /id="model-path"/);
  assert.doesNotMatch(markup, /preferences-model-path/);
  assert.doesNotMatch(script, /pathInput|#model-path/);
  assert.match(markup, /<html:select\s+id="duplicate-mode"\s+native="true">/);
  assert.match(section, /margin\s*:\s*0 0 32px/);
  assert.match(description, /color\s*:\s*var\(--fill-secondary, #666\)/);
  assert.match(description, /line-height\s*:\s*1\.5/);
  assert.match(description, /opacity\s*:\s*0\.78/);
  assert.match(settingGap, /margin-top\s*:\s*22px/);
});

function getRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}
