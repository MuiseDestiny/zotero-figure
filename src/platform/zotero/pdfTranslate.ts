import { config } from "../../../package.json";

interface PdfTranslateAPI {
  translate(
    text: string,
    options: { langto?: string; pluginID: string },
  ): Promise<unknown> | unknown;
}

export interface PdfTranslateContext {
  cacheKey: string;
  targetLanguage?: string;
}

export type PdfTranslateResult =
  | { available: false }
  | { available: true; text: string | undefined };

export function isPdfTranslateAvailable(host: unknown = Zotero): boolean {
  return getPdfTranslateAPI(host) !== undefined;
}

export async function translateWithPdfTranslate(
  text: string,
  host: unknown = Zotero,
  context: PdfTranslateContext = getPdfTranslateContext(host),
): Promise<PdfTranslateResult> {
  const api = getPdfTranslateAPI(host);
  if (!api) return { available: false };

  const options: { langto?: string; pluginID: string } = {
    pluginID: config.addonID,
  };
  if (context.targetLanguage) options.langto = context.targetLanguage;
  const response = await api.translate.call(api, text, options);
  return { available: true, text: extractPdfTranslateText(response) };
}

export function getPdfTranslateContext(
  host: unknown = Zotero,
): PdfTranslateContext {
  const targetLanguage = getPdfTranslateTargetLanguage(host);
  const cacheLanguage = encodeURIComponent(targetLanguage ?? "default");
  return {
    cacheKey: `zotero-pdf-translate/v1:${cacheLanguage}`,
    ...(targetLanguage ? { targetLanguage } : {}),
  };
}

export function extractPdfTranslateText(response: unknown): string | undefined {
  if (typeof response === "string") return response;
  if (!isObjectLike(response)) return undefined;
  if (typeof response.status === "string" && response.status !== "success") {
    return undefined;
  }
  return typeof response.result === "string" ? response.result : undefined;
}

function getPdfTranslateAPI(host: unknown): PdfTranslateAPI | undefined {
  try {
    if (!isObjectLike(host) || !isObjectLike(host.PDFTranslate))
      return undefined;

    const api = host.PDFTranslate.api;
    if (!isObjectLike(api) || typeof api.translate !== "function")
      return undefined;
    return api as unknown as PdfTranslateAPI;
  } catch {
    return undefined;
  }
}

function getPdfTranslateTargetLanguage(host: unknown): string | undefined {
  try {
    if (!isObjectLike(host) || !isObjectLike(host.Prefs)) return undefined;
    const get = host.Prefs.get;
    if (typeof get !== "function") return undefined;
    const value = get.call(host.Prefs, "ZoteroPDFTranslate.targetLanguage");
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= 80 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}
