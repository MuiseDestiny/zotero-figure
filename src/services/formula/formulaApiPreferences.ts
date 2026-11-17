import { getPref, setPref } from "../../utils/prefs";
import { getFormulaApiKey } from "../../platform/zotero/formulaApiCredentials";
import {
  SILICONFLOW_FORMULA_API,
  FormulaLatexServiceError,
  type FormulaApiConfig,
} from "./formulaLatexService";

export function getFormulaApiProvider(): FormulaApiConfig["provider"] {
  return getPref("formulaApiProvider") === "custom" ? "custom" : "siliconflow";
}

export async function getFormulaApiConfig(): Promise<FormulaApiConfig> {
  const provider = getFormulaApiProvider();
  const apiURL = getPref("customFormulaApiURL") ?? "";
  const model = getPref("customFormulaApiModel") ?? "";
  let apiKey: string;
  try {
    apiKey = await getFormulaApiKey(provider);
  } catch {
    throw new FormulaLatexServiceError("key-storage");
  }
  return provider === "custom"
    ? {
        apiKey,
        apiURL,
        model,
        provider: "custom",
      }
    : {
        ...SILICONFLOW_FORMULA_API,
        apiKey,
      };
}

export function isFormulaApiValidated(): boolean {
  return (
    getPref(
      getFormulaApiProvider() === "custom"
        ? "customFormulaApiValidated"
        : "siliconFlowApiKeyValidated",
    ) === true &&
    (getFormulaApiProvider() !== "custom" ||
      Boolean(
        getPref("customFormulaApiURL")?.trim() &&
        getPref("customFormulaApiModel")?.trim(),
      ))
  );
}

export function setFormulaApiValidated(valid: boolean): void {
  setPref(
    getFormulaApiProvider() === "custom"
      ? "customFormulaApiValidated"
      : "siliconFlowApiKeyValidated",
    valid,
  );
}
