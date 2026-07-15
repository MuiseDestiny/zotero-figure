import * as assert from "node:assert/strict";
import test from "node:test";
import { config } from "../package.json";
import {
  extractPdfTranslateText,
  getPdfTranslateContext,
  isPdfTranslateAvailable,
  translateWithPdfTranslate,
} from "../src/platform/zotero/pdfTranslate";

test("reports PDF Translate as unavailable when its API is missing", async () => {
  assert.equal(isPdfTranslateAvailable({}), false);
  assert.equal(isPdfTranslateAvailable({ PDFTranslate: { api: {} } }), false);
  assert.deepEqual(await translateWithPdfTranslate("Figure 1", {}), {
    available: false,
  });
});

test("treats a throwing PDF Translate property as unavailable", () => {
  const host = {};
  Object.defineProperty(host, "PDFTranslate", {
    get: () => {
      throw new Error("plugin is unloading");
    },
  });
  assert.equal(isPdfTranslateAvailable(host), false);
});

test("passes the add-on ID and preserves the PDF Translate API receiver", async () => {
  let receivedText: string | undefined;
  let receivedOptions: { pluginID: string } | undefined;
  let receivedCorrectReceiver = false;
  const api = {
    translate(
      this: unknown,
      text: string,
      options: { pluginID: string },
    ): { result: string; status: string } {
      receivedCorrectReceiver = this === api;
      receivedText = text;
      receivedOptions = options;
      return { result: "图 1", status: "success" };
    },
  };
  const host = { PDFTranslate: { api } };

  assert.equal(isPdfTranslateAvailable(host), true);
  assert.deepEqual(await translateWithPdfTranslate("Figure 1", host), {
    available: true,
    text: "图 1",
  });
  assert.equal(receivedCorrectReceiver, true);
  assert.equal(receivedText, "Figure 1");
  assert.deepEqual(receivedOptions, { pluginID: config.addonID });
});

test("accepts a direct string response from compatible implementations", async () => {
  const host = {
    PDFTranslate: {
      api: { translate: async () => "Таблица 1" },
    },
  };

  assert.deepEqual(await translateWithPdfTranslate("Table 1", host), {
    available: true,
    text: "Таблица 1",
  });
});

test("isolates cached translations by the configured target language", async () => {
  let receivedOptions: { langto?: string; pluginID: string } | undefined;
  const host = {
    PDFTranslate: {
      api: {
        translate: (
          _text: string,
          options: { langto?: string; pluginID: string },
        ) => {
          receivedOptions = options;
          return { result: "Figura 1", status: "success" };
        },
      },
    },
    Prefs: {
      get: (key: string) =>
        key === "ZoteroPDFTranslate.targetLanguage" ? "it-IT" : undefined,
    },
  };
  const context = getPdfTranslateContext(host);

  assert.deepEqual(context, {
    cacheKey: "zotero-pdf-translate/v1:it-IT",
    targetLanguage: "it-IT",
  });
  assert.deepEqual(await translateWithPdfTranslate("Figure 1", host, context), {
    available: true,
    text: "Figura 1",
  });
  assert.deepEqual(receivedOptions, {
    langto: "it-IT",
    pluginID: config.addonID,
  });
});

test("uses a stable default cache context without a target preference", () => {
  assert.deepEqual(getPdfTranslateContext({}), {
    cacheKey: "zotero-pdf-translate/v1:default",
  });
});

test("returns no text for unsupported response shapes", () => {
  assert.equal(extractPdfTranslateText(undefined), undefined);
  assert.equal(extractPdfTranslateText({ status: "failed" }), undefined);
  assert.equal(
    extractPdfTranslateText({ result: "partial", status: "failed" }),
    undefined,
  );
  assert.equal(extractPdfTranslateText({ result: 42 }), undefined);
});
