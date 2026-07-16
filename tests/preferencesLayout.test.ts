import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const markup = readFileSync("addon/chrome/content/preferences.xhtml", "utf8");
const zhLocale = readFileSync("addon/locale/zh-CN/preferences.ftl", "utf8");
const script = readFileSync(
  "src/features/preferences/preferenceScript.ts",
  "utf8",
);
const rootSelector = "#zotero-prefpane-__addonRef__";

test("shows model maintenance, annotation sync, and verified formula API preferences", () => {
  const styles = getInlineStyles();
  const helpIcon = getRule(`${rootSelector} .help-icon`);
  const helpIconSvg = getRule(`${rootSelector} .help-icon > svg`);
  const buttonRow = getRule(`${rootSelector} .button-row`);
  const adjacentButton = getRule(
    `${rootSelector} .button-row > .model-action-button + .model-action-button`,
  );
  const fieldRow = getRule(`${rootSelector} .field-row`);

  assert.doesNotMatch(markup, /id="model-path"/);
  assert.doesNotMatch(markup, /id="managed-model-path"/);
  assert.doesNotMatch(markup, /id="model-metadata"/);
  assert.doesNotMatch(markup, /id="duplicate-mode"/);
  assert.doesNotMatch(markup, /preferences-model-path/);
  assert.doesNotMatch(
    script,
    /pathInput|#model-path|storagePath|metadata|duplicateMode/,
  );
  assert.match(markup, /id="sync-annotations"[\s\S]*native="true"/);
  assert.match(markup, /id="siliconflow-api-key"[\s\S]*type="password"/);
  assert.match(markup, /id="verify-siliconflow-api-key"/);
  assert.match(
    markup,
    /id="verify-siliconflow-api-key"[\s\S]*id="get-siliconflow-api-key"/,
  );
  assert.match(script, /Zotero\.launchURL\(SILICONFLOW_API_KEY_URL\)/);
  assert.match(script, /https:\/\/cloud\.siliconflow\.cn\/i\/3Xa4I0X8/);
  assert.match(markup, /id="auto-recognize-formula-row"[\s\S]*hidden="true"/);
  assert.match(markup, /id="recognize-existing-formulae"/);
  assert.match(markup, /id="existing-formula-status"[\s\S]*hidden="true"/);
  assert.match(script, /validateSiliconFlowApiKey/);
  assert.match(script, /recognizeExistingFormulae/);
  assert.match(script, /preferences-existing-formulae-progress/);
  assert.match(script, /setPref\("siliconFlowApiKeyValidated", false\)/);
  assert.match(script, /toggleAttribute\("hidden", !valid\)/);
  assert.match(markup, /data-l10n-id="preferences-sync-annotations-help"/);
  assert.match(markup, /class="help-icon"[\s\S]*role="img"/);
  assert.match(markup, /<circle cx="12" cy="12" r="10"/);
  assert.match(markup, /<hbox class="button-row" align="center">/);
  assert.equal(countMatches(markup, /class="model-action-button"/g), 3);
  assert.doesNotMatch(markup, /model-button-slot|rel="stylesheet"/);
  assert.match(styles, /#zotero-prefpane-__addonRef__/);
  assert.doesNotMatch(markup, /vertical-gap/);
  assert.match(zhLocale, /\.tooltiptext\s*=/);
  assert.doesNotMatch(zhLocale, /\.title\s*=/);
  assert.doesNotMatch(script, /helpURL/);
  assert.match(helpIcon, /color\s*:\s*var\(--fill-secondary, #666\)/);
  assert.match(helpIcon, /cursor\s*:\s*help/);
  assert.match(helpIcon, /height\s*:\s*16px/);
  assert.match(helpIcon, /margin-inline-start\s*:\s*8px/);
  assert.match(helpIcon, /opacity\s*:\s*0\.65/);
  assert.match(helpIconSvg, /pointer-events\s*:\s*none/);
  assert.match(buttonRow, /display\s*:\s*flex/);
  assert.match(buttonRow, /margin-top\s*:\s*10px/);
  assert.match(adjacentButton, /margin-inline-start\s*:\s*8px/);
  assert.match(fieldRow, /margin-top\s*:\s*16px/);
});

test("invalidates and cancels stale formula API work", () => {
  assert.match(
    script,
    /apiKeyInput\.addEventListener\("input", \(\) => \{[\s\S]*apiValidationController\?\.abort\(\)[\s\S]*apiKeyVerifyButton\.removeAttribute\("disabled"\)/,
  );
  assert.match(
    script,
    /validateSiliconFlowApiKey\(key, \{ signal: controller\.signal \}\)/,
  );
  assert.match(script, /existingFormulaController\?\.abort\(\)/);
});

function getRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = getInlineStyles().match(
    new RegExp(`${escaped}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

function getInlineStyles(): string {
  const match = markup.match(/<html:style>([\s\S]*?)<\/html:style>/);
  assert.ok(match, "Preferences must define styles in an inline html:style");
  return match[1];
}

function countMatches(source: string, expression: RegExp): number {
  return source.match(expression)?.length ?? 0;
}
