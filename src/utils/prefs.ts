import { config } from "../../package.json";

export interface PreferenceSchema {
  autoRecognizeFormula: boolean;
  /** Legacy plaintext key: read only for migration to the login manager. */
  customFormulaApiKey: string;
  customFormulaApiModel: string;
  customFormulaApiURL: string;
  customFormulaApiValidated: boolean;
  duplicateMode: "replace-page" | "skip-existing";
  formulaApiProvider: "custom" | "siliconflow";
  /** Retired: migrated to the data directory by figureGalleryComparisonStore. */
  galleryComparisonLayouts: string;
  galleryImageScale: number;
  galleryViewMode: "document-columns" | "waterfall";
  /** Legacy plaintext key: read only for migration to the login manager. */
  siliconFlowApiKey: string;
  siliconFlowApiKeyValidated: boolean;
  syncAnnotations: boolean;
  view: "All" | "Annotation" | "Figure";
}

export function getPref<Key extends keyof PreferenceSchema>(
  key: Key,
): PreferenceSchema[Key] | undefined {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true) as
    | PreferenceSchema[Key]
    | undefined;
}

export function setPref<Key extends keyof PreferenceSchema>(
  key: Key,
  value: PreferenceSchema[Key],
): void {
  Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

export function clearPref(key: keyof PreferenceSchema): void {
  return Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}
