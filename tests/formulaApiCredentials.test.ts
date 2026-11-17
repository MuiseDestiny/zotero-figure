import * as assert from "node:assert/strict";
import test from "node:test";
import {
  getFormulaApiKey,
  saveFormulaApiKey,
} from "../src/platform/zotero/formulaApiCredentials";
import {
  getFormulaApiConfig,
  isFormulaApiValidated,
  setFormulaApiValidated,
} from "../src/services/formula/formulaApiPreferences";
import { getPref, setPref } from "../src/utils/prefs";
import { installFormulaCredentialsHarness } from "./helpers/formulaCredentials";

test("migrates legacy keys only after a successful secure save and retries failures", async () => {
  const harness = installFormulaCredentialsHarness();
  const legacy = "extensions.zotero.zoterofigure.siliconFlowApiKey";
  harness.prefs.set(legacy, "test-legacy-key");
  try {
    harness.failSave(true);
    await assert.rejects(getFormulaApiKey("siliconflow"));
    assert.equal(harness.prefs.has(legacy), true);
    harness.failSave(false);
    assert.equal(await getFormulaApiKey("siliconflow"), "test-legacy-key");
    assert.equal(harness.prefs.has(legacy), false);
    assert.equal(harness.adds, 1);
    assert.equal(await getFormulaApiKey("siliconflow"), "test-legacy-key");
    assert.equal(harness.adds, 1);
  } finally {
    harness.restore();
  }
});

test("keeps provider keys separate, serializes updates, and clears removed keys", async () => {
  const harness = installFormulaCredentialsHarness();
  try {
    await Promise.all([
      saveFormulaApiKey("custom", "test-first-key"),
      saveFormulaApiKey("custom", "test-second-key"),
      saveFormulaApiKey("siliconflow", "test-default-key"),
    ]);
    assert.equal(await getFormulaApiKey("custom"), "test-second-key");
    assert.equal(await getFormulaApiKey("siliconflow"), "test-default-key");
    assert.equal(harness.logins.length, 2);
    await saveFormulaApiKey("custom", "");
    assert.equal(await getFormulaApiKey("custom"), "");
    assert.equal(harness.logins.length, 1);
  } finally {
    harness.restore();
  }
});

test("uses the active provider's configuration and validation state", async () => {
  const harness = installFormulaCredentialsHarness();
  try {
    await saveFormulaApiKey("custom", "test-custom-key");
    await saveFormulaApiKey("siliconflow", "test-default-key");
    assert.equal((await getFormulaApiConfig()).provider, "siliconflow");
    setFormulaApiValidated(true);
    setPref("formulaApiProvider", "custom");
    assert.equal(isFormulaApiValidated(), false);
    setPref("customFormulaApiURL", "https://example.com/v1/chat/completions");
    setPref("customFormulaApiModel", "vision-model");
    setFormulaApiValidated(true);
    assert.equal(isFormulaApiValidated(), true);
    assert.deepEqual(await getFormulaApiConfig(), {
      apiKey: "test-custom-key",
      apiURL: "https://example.com/v1/chat/completions",
      model: "vision-model",
      provider: "custom",
    });
    setPref("formulaApiProvider", "siliconflow");
    assert.equal(isFormulaApiValidated(), true);
    assert.equal((await getFormulaApiConfig()).apiKey, "test-default-key");
    assert.equal(getPref("siliconFlowApiKey"), undefined);
    assert.equal(getPref("customFormulaApiKey"), undefined);
  } finally {
    harness.restore();
  }
});

test("supports Gecko login managers with asynchronous update and removal APIs", async () => {
  const harness = installFormulaCredentialsHarness(true);
  try {
    await saveFormulaApiKey("custom", "test-first-key");
    await saveFormulaApiKey("custom", "test-updated-key");
    assert.equal(await getFormulaApiKey("custom"), "test-updated-key");
    await saveFormulaApiKey("custom", "");
    assert.equal(await getFormulaApiKey("custom"), "");
    assert.equal(harness.logins.length, 0);
  } finally {
    harness.restore();
  }
});

test("serializes legacy migration with a concurrent newer key save", async () => {
  const harness = installFormulaCredentialsHarness();
  harness.prefs.set(
    "extensions.zotero.zoterofigure.siliconFlowApiKey",
    "test-legacy-key",
  );
  try {
    await Promise.all([
      getFormulaApiKey("siliconflow"),
      saveFormulaApiKey("siliconflow", "test-new-key"),
    ]);
    assert.equal(await getFormulaApiKey("siliconflow"), "test-new-key");
    assert.equal(getPref("siliconFlowApiKey"), undefined);
  } finally {
    harness.restore();
  }
});
