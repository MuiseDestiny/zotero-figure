import * as assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  cleanLatexResponse,
  FormulaLatexServiceError,
  recognizeFormulaLatex,
  SILICONFLOW_CHAT_COMPLETIONS_URL,
  SILICONFLOW_FORMULA_MODEL,
  validateSiliconFlowApiKey,
} from "../src/services/formula/formulaLatexService";
import { OperationCancelledError } from "../src/utils/cancellation";

test("sends a fixed non-thinking formula request without exposing the key", async () => {
  let requestURL = "";
  let requestInit: RequestInit | undefined;
  const latex = await recognizeFormulaLatex(
    Uint8Array.from([1, 2, 3]),
    " secret-key ",
    {
      fetcher: (async (url, init) => {
        requestURL = String(url);
        requestInit = init;
        return jsonResponse({
          choices: [{ message: { content: "```latex\n$$x^2 + y_1$$\n```" } }],
        });
      }) as typeof fetch,
    },
  );

  assert.equal(latex, "x^2 + y_1");
  assert.equal(requestURL, SILICONFLOW_CHAT_COMPLETIONS_URL);
  assert.equal(requestInit?.method, "POST");
  const headers = requestInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  const bodySource = String(requestInit?.body);
  assert.equal(bodySource.includes("secret-key"), false);
  const body = JSON.parse(bodySource) as {
    enable_thinking: boolean;
    max_tokens: number;
    messages: Array<{
      content: Array<{
        image_url?: { url: string };
        text?: string;
        type: string;
      }>;
    }>;
    model: string;
    stream: boolean;
    temperature: number;
  };
  assert.equal(body.model, SILICONFLOW_FORMULA_MODEL);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].content[0].type, "text");
  assert.match(body.messages[0].content[0].text ?? "", /Return only the LaTeX/);
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.equal(
    body.messages[0].content[1].image_url?.url,
    "data:image/png;base64,AQID",
  );
});

test("validates the configured model with a minimal non-thinking request", async () => {
  let body: Record<string, unknown> | undefined;
  await validateSiliconFlowApiKey("key", {
    fetcher: (async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    }) as typeof fetch,
  });
  assert.equal(body?.model, SILICONFLOW_FORMULA_MODEL);
  assert.equal(body?.enable_thinking, false);
  assert.equal(body?.temperature, 0);
  assert.equal(body?.max_tokens, 2);
});

test("accepts IO byte views created in another browser realm", async () => {
  const image = runInNewContext("Uint8Array.from([1, 2, 3])") as Uint8Array;
  assert.equal(image instanceof Uint8Array, false);
  const latex = await recognizeFormulaLatex(image, "key", {
    fetcher: (async () =>
      jsonResponse({
        choices: [{ message: { content: "x" } }],
      })) as typeof fetch,
  });
  assert.equal(latex, "x");
});

test("normalizes common display delimiters", () => {
  assert.equal(cleanLatexResponse(" \\[a+b\\] "), "a+b");
  assert.equal(cleanLatexResponse("$c$"), "c");
  assert.equal(cleanLatexResponse("\\frac{1}{2}"), "\\frac{1}{2}");
});

test("reports missing keys, HTTP failures, network failures, and bad payloads", async () => {
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), ""),
    hasCode("missing-key"),
  );
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), "key", {
      fetcher: (async () =>
        new Response("denied", { status: 401 })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof FormulaLatexServiceError &&
      error.code === "http" &&
      error.status === 401,
  );
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), "key", {
      fetcher: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    }),
    hasCode("network"),
  );
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), "key", {
      fetcher: (async () => jsonResponse({ choices: [] })) as typeof fetch,
    }),
    hasCode("invalid-response"),
  );
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), "key", {
      fetcher: (async () =>
        jsonResponse({
          choices: [
            { finish_reason: "length", message: { content: "\\frac{1" } },
          ],
        })) as typeof fetch,
    }),
    hasCode("invalid-response"),
  );
  await assert.rejects(
    recognizeFormulaLatex(Uint8Array.of(1), "key", {
      fetcher: (async () =>
        jsonResponse({
          choices: [
            {
              finish_reason: "content_filter",
              message: { content: "partial" },
            },
          ],
        })) as typeof fetch,
    }),
    hasCode("invalid-response"),
  );
});

test("observes external cancellation as OperationCancelledError", async () => {
  const controller = new AbortController();
  const request = recognizeFormulaLatex(Uint8Array.of(1), "key", {
    fetcher: abortingFetcher,
    signal: controller.signal,
    timeoutMs: 1_000,
  });

  controller.abort();

  await assert.rejects(request, OperationCancelledError);
});

test("aborts hung requests after the configured timeout", async () => {
  await assert.rejects(
    validateSiliconFlowApiKey("key", {
      fetcher: abortingFetcher,
      timeoutMs: 5,
    }),
    hasCode("timeout"),
  );
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function hasCode(code: FormulaLatexServiceError["code"]) {
  return (error: unknown) =>
    error instanceof FormulaLatexServiceError && error.code === code;
}

const abortingFetcher = (async (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () =>
      reject(new DOMException("Request aborted", "AbortError"));
    if (init?.signal?.aborted) {
      rejectAbort();
      return;
    }
    init?.signal?.addEventListener("abort", rejectAbort, { once: true });
  })) as typeof fetch;
