import { bytesToDataURL } from "../../utils/dataURL";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";

export const SILICONFLOW_FORMULA_MODEL = "Qwen/Qwen3.6-35B-A3B";
export const SILICONFLOW_CHAT_COMPLETIONS_URL =
  "https://api.siliconflow.cn/v1/chat/completions";
export const FORMULA_REQUEST_TIMEOUT_MS = 120_000;

const FORMULA_PROMPT =
  "Transcribe the mathematical formula in this image into valid LaTeX. " +
  "Return only the LaTeX source, without dollar signs, code fences, or " +
  "explanation. Preserve all subscripts, superscripts, Greek letters, " +
  "operators, matrices, alignment, accents, text labels, and delimiters " +
  "exactly as shown. Ignore surrounding prose if it is not part of the formula.";

export type FormulaLatexErrorCode =
  | "http"
  | "invalid-response"
  | "missing-key"
  | "network"
  | "timeout";

export interface FormulaLatexRequestOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class FormulaLatexServiceError extends Error {
  constructor(
    public readonly code: FormulaLatexErrorCode,
    public readonly status?: number,
  ) {
    super(code);
    this.name = "FormulaLatexServiceError";
  }
}

export async function recognizeFormulaLatex(
  image: Uint8Array,
  apiKey: string,
  options: FormulaLatexRequestOptions = {},
): Promise<string> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new FormulaLatexServiceError("missing-key");
  // IOUtils may return a typed array from another Firefox realm, where
  // instanceof Uint8Array is false even though the byte view is valid.
  if (image.byteLength === 0) {
    throw new FormulaLatexServiceError("invalid-response");
  }

  const request = createRequestContext(options);
  try {
    const response = await request.fetcher(SILICONFLOW_CHAT_COMPLETIONS_URL, {
      body: JSON.stringify({
        enable_thinking: false,
        max_tokens: 1024,
        messages: [
          {
            content: [
              { text: FORMULA_PROMPT, type: "text" },
              {
                image_url: {
                  url: bytesToDataURL(image, "image/png"),
                },
                type: "image_url",
              },
            ],
            role: "user",
          },
        ],
        model: SILICONFLOW_FORMULA_MODEL,
        stream: false,
        temperature: 0,
      }),
      headers: {
        Authorization: `Bearer ${normalizedKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: request.signal,
    });
    if (!response.ok) {
      throw new FormulaLatexServiceError("http", response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await response.text()) as unknown;
    } catch {
      throw new FormulaLatexServiceError("invalid-response");
    }
    const content = getResponseContent(payload);
    const latex = content === undefined ? "" : cleanLatexResponse(content);
    if (!latex) throw new FormulaLatexServiceError("invalid-response");
    return latex;
  } catch (error) {
    throw resolveRequestError(error, request, options.signal);
  } finally {
    request.dispose();
  }
}

export async function validateSiliconFlowApiKey(
  apiKey: string,
  options: FormulaLatexRequestOptions = {},
): Promise<void> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new FormulaLatexServiceError("missing-key");
  const request = createRequestContext(options);
  try {
    const response = await request.fetcher(SILICONFLOW_CHAT_COMPLETIONS_URL, {
      body: JSON.stringify({
        enable_thinking: false,
        max_tokens: 2,
        messages: [{ content: "Reply with OK only.", role: "user" }],
        model: SILICONFLOW_FORMULA_MODEL,
        stream: false,
        temperature: 0,
      }),
      headers: {
        Authorization: `Bearer ${normalizedKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: request.signal,
    });
    if (!response.ok) {
      throw new FormulaLatexServiceError("http", response.status);
    }
    try {
      const payload = JSON.parse(await response.text()) as unknown;
      if (getResponseContent(payload)?.trim()) return;
    } catch {
      // Report every malformed success response through one stable error code.
    }
    throw new FormulaLatexServiceError("invalid-response");
  } catch (error) {
    throw resolveRequestError(error, request, options.signal);
  } finally {
    request.dispose();
  }
}

export function cleanLatexResponse(value: string): string {
  let latex = value.trim();
  const fenced = latex.match(/^```(?:latex|tex)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) latex = fenced[1].trim();
  const delimiters: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [start, end] of delimiters) {
    if (latex.startsWith(start) && latex.endsWith(end)) {
      latex = latex.slice(start.length, -end.length).trim();
      break;
    }
  }
  return latex;
}

function getResponseContent(value: unknown): string | undefined {
  if (!isObject(value) || !Array.isArray(value.choices)) return undefined;
  const first = value.choices[0];
  if (!isObject(first) || !isObject(first.message)) return undefined;
  if (
    first.finish_reason !== undefined &&
    first.finish_reason !== null &&
    first.finish_reason !== "stop"
  ) {
    return undefined;
  }
  return typeof first.message.content === "string"
    ? first.message.content
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FormulaRequestContext {
  dispose(): void;
  readonly fetcher: typeof fetch;
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
}

function createRequestContext(
  options: FormulaLatexRequestOptions,
): FormulaRequestContext {
  throwIfAborted(options.signal);
  const timeoutMs = options.timeoutMs ?? FORMULA_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Formula request timeout must be positive");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeoutID = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    dispose: () => {
      clearTimeout(timeoutID);
      options.signal?.removeEventListener("abort", abort);
    },
    fetcher: options.fetcher ?? fetch,
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
  };
}

function resolveRequestError(
  error: unknown,
  request: FormulaRequestContext,
  externalSignal?: AbortSignal,
): Error {
  if (externalSignal?.aborted) return new OperationCancelledError();
  if (request.timedOut) return new FormulaLatexServiceError("timeout");
  if (error instanceof FormulaLatexServiceError) return error;
  return new FormulaLatexServiceError("network");
}
