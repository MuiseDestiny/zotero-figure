import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  disposePrefsScripts,
  registerPrefsScripts,
} from "../src/features/preferences/preferenceScript";
import { modelManager } from "../src/services/model/modelManager";
import { getFormulaApiConfig } from "../src/services/formula/formulaApiPreferences";
import { getPref, setPref } from "../src/utils/prefs";
import { installFormulaCredentialsHarness } from "./helpers/formulaCredentials";

class PreferenceElement extends EventTarget {
  public value = "";
  public textContent = "";
  public checked = false;
  public disabled = false;
  public focused = false;
  private readonly attributes = new Map<string, string>();
  public focus(): void {
    this.focused = true;
  }
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  public toggleAttribute(name: string, force: boolean): void {
    if (force) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }
}

function installHarness() {
  const credentials = installFormulaCredentialsHarness();
  const globals = globalThis as any;
  const previousAddon = globals.addon;
  const previousFetch = globals.fetch;
  const previousEnsure = modelManager.ensureRecommendedModel;
  const previousValidate = modelManager.validateConfiguredModel;
  globals.addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  };
  modelManager.ensureRecommendedModel = async () => ({
    path: "/model",
    state: "missing",
  });
  modelManager.validateConfiguredModel = async () => ({
    path: "/model",
    state: "missing",
  });
  const elements = new Map<string, PreferenceElement>();
  for (const [, id] of readFileSync(
    "addon/chrome/content/preferences.xhtml",
    "utf8",
  ).matchAll(/\bid="([\w-]+)"/g)) {
    elements.set(`#${id}`, new PreferenceElement());
  }
  const window = Object.assign(new EventTarget(), {
    AbortController,
    document: { querySelector: (selector: string) => elements.get(selector) },
  });
  registerPrefsScripts(window as unknown as Window, {
    openGallery: () => undefined,
    recognizeExistingFormulae: async () => ({
      failed: 0,
      succeeded: 0,
      total: 0,
    }),
  });
  return {
    ...credentials,
    element: (id: string) => elements.get(`#${id}`)!,
    command: (id: string) =>
      elements.get(`#${id}`)!.dispatchEvent(new Event("command")),
    restore() {
      disposePrefsScripts();
      modelManager.ensureRecommendedModel = previousEnsure;
      modelManager.validateConfiguredModel = previousValidate;
      globals.addon = previousAddon;
      globals.fetch = previousFetch;
      credentials.restore();
    },
  };
}

test("saves the custom form and automatically checks the same API and model", async () => {
  const harness = installHarness();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return response("OK");
  }) as typeof fetch;
  try {
    await settle();
    harness.command("customize-formula-api");
    await settle();
    assert.equal(harness.element("custom-formula-api-url").focused, true);
    harness.element("custom-formula-api-url").value = "https://example.com/v1/";
    harness.element("custom-formula-api-key").value = "test-custom-key";
    harness.element("custom-formula-api-model").value = "vision-model";
    harness.command("save-custom-formula-api");
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://example.com/v1/chat/completions");
    assert.equal(requests[0].body.model, "vision-model");
    assert.deepEqual(requests[0].body.messages, [
      { role: "user", content: "Reply with OK only." },
    ]);
    assert.equal(getPref("customFormulaApiValidated"), true);
    assert.equal(
      harness.element("siliconflow-api-status").getAttribute("data-state"),
      "valid",
    );
    assert.equal((await getFormulaApiConfig()).model, "vision-model");
    assert.equal(harness.element("custom-formula-api-key").value, "");
    assert.equal(getPref("customFormulaApiKey"), undefined);
    harness.command("customize-formula-api");
    await settle();
    harness.element("custom-formula-api-model").value = "unsaved-model";
    harness.command("cancel-custom-formula-api");
    assert.equal((await getFormulaApiConfig()).model, "vision-model");
    assert.equal(requests.length, 1);
    harness.command("customize-formula-api");
    await settle();
    harness.command("use-default-formula-api");
    await settle();
    assert.equal((await getFormulaApiConfig()).provider, "siliconflow");
    assert.equal(getPref("autoRecognizeFormula"), false);
  } finally {
    harness.restore();
  }
});

test("cancels stale checks on edits and removes event handlers on plugin shutdown", async () => {
  const harness = installHarness();
  let requestSignal: AbortSignal | undefined;
  let finish!: (value: Response) => void;
  globalThis.fetch = (async (_url, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  }) as typeof fetch;
  try {
    await settle();
    harness.element("siliconflow-api-key").value = "test-key";
    harness.command("verify-siliconflow-api-key");
    await settle();
    assert.ok(requestSignal);
    harness.element("siliconflow-api-key").value = "changed-test-key";
    harness.element("siliconflow-api-key").dispatchEvent(new Event("input"));
    assert.equal(requestSignal.aborted, true);
    finish(response("OK"));
    await settle();
    assert.equal(getPref("siliconFlowApiKeyValidated"), false);
    assert.equal(
      harness.element("siliconflow-api-status").getAttribute("data-state"),
      "idle",
    );
    disposePrefsScripts();
    setPref("autoRecognizeFormula", true);
    harness.element("siliconflow-api-key").dispatchEvent(new Event("input"));
    assert.equal(getPref("autoRecognizeFormula"), true);
    assert.equal(harness.element("siliconflow-api-key").value, "");
  } finally {
    harness.restore();
  }
});

test("shows invalid form errors without saving or sending a request", async () => {
  const harness = installHarness();
  globalThis.fetch = (async () =>
    assert.fail("must not fetch")) as typeof fetch;
  try {
    await settle();
    harness.command("customize-formula-api");
    await settle();
    harness.element("custom-formula-api-url").value = "invalid";
    harness.element("custom-formula-api-key").value = "test-key";
    harness.element("custom-formula-api-model").value = "vision-model";
    harness.command("save-custom-formula-api");
    await settle();
    assert.match(
      harness.element("custom-formula-api-error").textContent,
      /url-invalid/,
    );
    assert.equal((await getFormulaApiConfig()).provider, "siliconflow");
    assert.equal(harness.logins.length, 0);
  } finally {
    harness.restore();
  }
});

function response(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
