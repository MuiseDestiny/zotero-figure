import { config, version } from "../../../package.json";
import {
  formatFileSize,
  RECOMMENDED_MODEL,
  shortHash,
} from "../../services/model/modelCatalog";
import {
  modelManager,
  type ModelValidation,
} from "../../services/model/modelManager";
import {
  FormulaLatexServiceError,
  normalizeFormulaApiConfig,
  validateFormulaApiConfig,
} from "../../services/formula/formulaLatexService";
import {
  getFormulaApiConfig,
  getFormulaApiProvider,
  isFormulaApiValidated,
  setFormulaApiValidated,
} from "../../services/formula/formulaApiPreferences";
import {
  getFormulaApiKey,
  saveFormulaApiKey,
} from "../../platform/zotero/formulaApiCredentials";
import type {
  FormulaLatexBatchProgress,
  FormulaLatexBatchSummary,
} from "../../services/formula/formulaLatexCoordinator";
import { isCancellationError } from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";

const SILICONFLOW_API_KEY_URL = "https://cloud.siliconflow.cn/i/3Xa4I0X8";

let preferencePaneID: string | undefined;
const controllers = new Map<Window, ModelPreferencesController>();

export interface PreferencesOptions {
  openGallery(): void;
  recognizeExistingFormulae(
    onProgress: (progress: FormulaLatexBatchProgress) => void,
    signal?: AbortSignal,
  ): Promise<FormulaLatexBatchSummary>;
}

export async function registerPrefs(): Promise<void> {
  if (preferencePaneID) return;
  preferencePaneID = await Zotero.PreferencePanes.register({
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    label: config.addonName,
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
  });
}

export function registerPrefsScripts(
  window: Window,
  options: PreferencesOptions,
): void {
  if (controllers.has(window)) return;
  const controller = new ModelPreferencesController(window, options);
  controllers.set(window, controller);
  void controller.start();
}

export function disposePrefsScripts(): void {
  for (const controller of controllers.values()) controller.dispose();
  controllers.clear();
}

class ModelPreferencesController {
  private readonly aboutVersion: Element;
  private readonly apiKeyInput: HTMLInputElement;
  private readonly apiKeyLabel: Element;
  private readonly apiKeyControl: Element;
  private readonly apiKeyStatus: Element;
  private readonly apiKeyVerifyButton: Element;
  private apiValidationController?: AbortController;
  private apiValidationToken = 0;
  private customEditorToken = 0;
  private readonly eventController: AbortController;
  private readonly customApiButton: Element;
  private readonly customApiEditor: Element;
  private readonly customApiKey: HTMLInputElement;
  private readonly customApiModel: HTMLInputElement;
  private readonly customApiURL: HTMLInputElement;
  private readonly customApiSave: Element;
  private readonly customApiCancel: Element;
  private readonly customApiDefault: Element;
  private readonly customApiError: Element;
  private readonly autoRecognizeFormula: Element & { checked: boolean };
  private readonly autoRecognizeFormulaRow: Element;
  private closed = false;
  private readonly existingFormulaButton: Element;
  private existingFormulaController?: AbortController;
  private readonly existingFormulaStatus: Element;
  private readonly getApiKeyButton: Element;
  private readonly openGalleryButton: Element;
  private readonly syncAnnotations: Element & { checked: boolean };
  private installController?: AbortController;
  private readonly revealButton: Element;
  private refreshToken = 0;
  private readonly restoreButton: Element;
  private readonly status: Element;
  private readonly statusRow: Element;
  private readonly verifyButton: Element;

  constructor(
    private readonly window: Window,
    private readonly options: PreferencesOptions,
  ) {
    const doc = window.document;
    this.eventController = new window.AbortController();
    this.aboutVersion = requireElement(doc, "#about-version");
    this.apiKeyInput = requireElement(doc, "#siliconflow-api-key");
    this.apiKeyLabel = requireElement(doc, "#formula-api-label");
    this.apiKeyControl = requireElement(doc, "#formula-api-control");
    this.customApiButton = requireElement(doc, "#customize-formula-api");
    this.customApiEditor = requireElement(doc, "#custom-formula-api-editor");
    this.customApiKey = requireElement(doc, "#custom-formula-api-key");
    this.customApiModel = requireElement(doc, "#custom-formula-api-model");
    this.customApiURL = requireElement(doc, "#custom-formula-api-url");
    this.customApiSave = requireElement(doc, "#save-custom-formula-api");
    this.customApiCancel = requireElement(doc, "#cancel-custom-formula-api");
    this.customApiDefault = requireElement(doc, "#use-default-formula-api");
    this.customApiError = requireElement(doc, "#custom-formula-api-error");
    this.apiKeyStatus = requireElement(doc, "#siliconflow-api-status");
    this.apiKeyVerifyButton = requireElement(
      doc,
      "#verify-siliconflow-api-key",
    );
    this.autoRecognizeFormula = requireElement(doc, "#auto-recognize-formula");
    this.autoRecognizeFormulaRow = requireElement(
      doc,
      "#auto-recognize-formula-row",
    );
    this.existingFormulaButton = requireElement(
      doc,
      "#recognize-existing-formulae",
    );
    this.existingFormulaStatus = requireElement(
      doc,
      "#existing-formula-status",
    );
    this.getApiKeyButton = requireElement(doc, "#get-siliconflow-api-key");
    this.openGalleryButton = requireElement(doc, "#open-figure-gallery");
    this.syncAnnotations = requireElement(doc, "#sync-annotations");
    this.revealButton = requireElement(doc, "#reveal-model");
    this.restoreButton = requireElement(doc, "#restore-model");
    this.status = requireElement(doc, "#model-status");
    this.statusRow = requireElement(doc, "#model-status-row");
    this.verifyButton = requireElement(doc, "#verify-model");
  }

  public async start(): Promise<void> {
    this.aboutVersion.textContent = getString("preferences-about-version", {
      args: { version },
    });
    this.listen(this.apiKeyInput, "input", () => {
      this.invalidateApiConfig();
    });
    this.listen(this.apiKeyInput, "change", () => {
      void saveFormulaApiKey(
        getFormulaApiProvider(),
        this.apiKeyInput.value,
      ).catch(() => {
        if (!this.closed)
          this.renderApiValidation(
            false,
            getString("error-formula-api-key-storage"),
          );
      });
    });
    this.listen(this.customApiButton, "command", () => {
      void this.openCustomApi();
    });
    this.listen(this.customApiCancel, "command", () => {
      this.setCustomApiEditorOpen(false);
    });
    this.listen(this.customApiSave, "command", () => {
      void this.saveCustomApi();
    });
    this.listen(this.customApiDefault, "command", () => {
      void this.useDefaultApi();
    });
    this.listen(this.apiKeyVerifyButton, "command", () => {
      void this.verifyApiKey();
    });
    this.listen(this.getApiKeyButton, "command", () => {
      Zotero.launchURL(SILICONFLOW_API_KEY_URL);
    });
    this.listen(this.openGalleryButton, "command", () => {
      this.options.openGallery();
    });
    this.listen(this.autoRecognizeFormula, "command", () => {
      setPref("autoRecognizeFormula", this.autoRecognizeFormula.checked);
    });
    this.listen(this.existingFormulaButton, "command", () => {
      void this.recognizeExistingFormulae();
    });
    this.listen(this.restoreButton, "command", () => {
      void this.prepareModel(true);
    });
    this.listen(this.verifyButton, "command", () => {
      void this.refresh(true);
    });
    this.listen(this.revealButton, "command", () => {
      void this.revealModel();
    });
    this.listen(this.syncAnnotations, "command", () => {
      setPref("syncAnnotations", this.syncAnnotations.checked);
    });
    this.listen(
      this.window,
      "unload",
      () => {
        this.dispose();
        controllers.delete(this.window);
      },
      { once: true },
    );
    this.syncAnnotations.checked = getPref("syncAnnotations") === true;
    this.resetRestoreLabel();
    void this.prepareModel(false);
    this.apiKeyInput.disabled = true;
    this.apiKeyVerifyButton.setAttribute("disabled", "true");
    this.customApiButton.setAttribute("disabled", "true");
    try {
      await this.renderApiConfig();
      if (this.closed) return;
      this.autoRecognizeFormula.checked =
        getPref("autoRecognizeFormula") === true;
      this.renderApiValidation(isFormulaApiValidated());
    } catch {
      if (!this.closed)
        this.renderApiValidation(
          false,
          getString("error-formula-api-key-storage"),
        );
    } finally {
      if (!this.closed) {
        this.apiKeyInput.disabled = false;
        this.apiKeyVerifyButton.removeAttribute("disabled");
        this.customApiButton.removeAttribute("disabled");
      }
    }
  }

  public dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.refreshToken++;
    this.apiValidationToken++;
    this.customEditorToken++;
    this.eventController.abort();
    this.apiValidationController?.abort();
    this.existingFormulaController?.abort();
    this.installController?.abort();
    this.apiKeyInput.value = "";
    this.customApiKey.value = "";
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: () => void,
    options: AddEventListenerOptions = {},
  ): void {
    target.addEventListener(type, listener, {
      ...options,
      signal: this.eventController.signal,
    });
  }

  private setCustomApiEditorOpen(open: boolean): void {
    this.customEditorToken++;
    this.customApiEditor.toggleAttribute("hidden", !open);
    this.apiKeyControl.toggleAttribute("hidden", open);
    this.customApiButton.toggleAttribute("disabled", open);
    if (!open) {
      this.customApiKey.value = "";
      (this.customApiButton as HTMLElement).focus();
    }
  }

  private async openCustomApi(): Promise<void> {
    this.customApiURL.value = getPref("customFormulaApiURL") ?? "";
    this.customApiModel.value = getPref("customFormulaApiModel") ?? "";
    this.customApiError.setAttribute("hidden", "true");
    this.customApiButton.setAttribute("disabled", "true");
    const token = ++this.customEditorToken;
    try {
      const key = await getFormulaApiKey("custom");
      if (this.closed || token !== this.customEditorToken) return;
      this.customApiKey.value = key;
      this.setCustomApiEditorOpen(true);
      this.customApiURL.focus();
    } catch {
      if (!this.closed && token === this.customEditorToken) {
        this.customApiButton.removeAttribute("disabled");
        this.renderApiValidation(
          false,
          getString("error-formula-api-key-storage"),
        );
      }
    }
  }

  private async renderApiConfig(): Promise<void> {
    const config = await getFormulaApiConfig();
    if (this.closed || config.provider !== getFormulaApiProvider()) return;
    this.apiKeyInput.value = config.apiKey;
    // These labels use the runtime Fluent bundle because the custom model is dynamic.
    this.apiKeyLabel.textContent = getString(
      config.provider === "custom"
        ? "preferences-custom-api-label"
        : "preferences-default-api-label",
      { args: { model: config.model } },
    );
    this.getApiKeyButton.toggleAttribute(
      "hidden",
      config.provider === "custom",
    );
  }

  private async useDefaultApi(): Promise<void> {
    setPref("formulaApiProvider", "siliconflow");
    this.invalidateApiConfig();
    this.setCustomApiEditorOpen(false);
    try {
      await this.renderApiConfig();
      if (!this.closed && this.apiKeyInput.value.trim())
        void this.verifyApiKey();
    } catch {
      if (!this.closed)
        this.renderApiValidation(
          false,
          getString("error-formula-api-key-storage"),
        );
    }
  }

  private async saveCustomApi(): Promise<void> {
    this.customApiSave.setAttribute("disabled", "true");
    this.customApiDefault.setAttribute("disabled", "true");
    this.customApiCancel.setAttribute("disabled", "true");
    this.customApiURL.disabled = true;
    this.customApiKey.disabled = true;
    this.customApiModel.disabled = true;
    try {
      const config = normalizeFormulaApiConfig({
        apiKey: this.customApiKey.value,
        apiURL: this.customApiURL.value,
        model: this.customApiModel.value,
        provider: "custom",
      });
      this.invalidateApiConfig();
      try {
        await saveFormulaApiKey("custom", config.apiKey);
      } catch {
        throw new FormulaLatexServiceError("key-storage");
      }
      if (this.closed) return;
      setPref("customFormulaApiURL", config.apiURL);
      setPref("customFormulaApiModel", config.model);
      setPref("formulaApiProvider", "custom");
      this.invalidateApiConfig();
      this.setCustomApiEditorOpen(false);
      await this.renderApiConfig();
      if (!this.closed) void this.verifyApiKey();
    } catch (error) {
      if (this.closed) return;
      this.customApiError.textContent = localizeFormulaApiError(error);
      this.customApiError.removeAttribute("hidden");
    } finally {
      if (!this.closed) {
        this.customApiSave.removeAttribute("disabled");
        this.customApiDefault.removeAttribute("disabled");
        this.customApiCancel.removeAttribute("disabled");
        this.customApiURL.disabled = false;
        this.customApiKey.disabled = false;
        this.customApiModel.disabled = false;
      }
    }
  }

  private invalidateApiConfig(): void {
    this.apiValidationController?.abort();
    this.apiValidationController = undefined;
    this.existingFormulaController?.abort();
    this.existingFormulaController = undefined;
    this.apiValidationToken++;
    setFormulaApiValidated(false);
    setPref("autoRecognizeFormula", false);
    this.autoRecognizeFormula.checked = false;
    this.apiKeyVerifyButton.removeAttribute("disabled");
    this.existingFormulaButton.removeAttribute("disabled");
    this.renderApiValidation(false);
  }

  private async verifyApiKey(): Promise<void> {
    this.apiValidationController?.abort();
    const controller = new this.window.AbortController();
    this.apiValidationController = controller;
    const token = ++this.apiValidationToken;
    this.apiKeyVerifyButton.setAttribute("disabled", "true");
    this.apiKeyStatus.setAttribute("data-state", "checking");
    this.apiKeyStatus.textContent = getString(
      "preferences-api-status-checking",
    );
    try {
      try {
        await saveFormulaApiKey(
          getFormulaApiProvider(),
          this.apiKeyInput.value,
        );
      } catch {
        throw new FormulaLatexServiceError("key-storage");
      }
      const config = await getFormulaApiConfig();
      if (this.closed || token !== this.apiValidationToken) return;
      await validateFormulaApiConfig(config, { signal: controller.signal });
      const current = await getFormulaApiConfig();
      if (this.closed || token !== this.apiValidationToken) return;
      if (
        config.provider !== current.provider ||
        config.apiURL !== current.apiURL ||
        config.model !== current.model ||
        config.apiKey !== current.apiKey
      ) {
        this.renderApiValidation(false);
        return;
      }
      setFormulaApiValidated(true);
      this.renderApiValidation(true);
    } catch (error) {
      if (this.closed || token !== this.apiValidationToken) return;
      setFormulaApiValidated(false);
      setPref("autoRecognizeFormula", false);
      this.autoRecognizeFormula.checked = false;
      this.renderApiValidation(false, localizeFormulaApiError(error));
    } finally {
      if (this.apiValidationController === controller) {
        this.apiValidationController = undefined;
      }
      if (
        !this.closed &&
        token === this.apiValidationToken &&
        this.apiValidationController === undefined
      ) {
        this.apiKeyVerifyButton.removeAttribute("disabled");
      }
    }
  }

  private renderApiValidation(valid: boolean, error?: string): void {
    this.autoRecognizeFormulaRow.toggleAttribute("hidden", !valid);
    if (!valid) this.existingFormulaStatus.setAttribute("hidden", "true");
    this.apiKeyStatus.setAttribute(
      "data-state",
      error ? "invalid" : valid ? "valid" : "idle",
    );
    this.apiKeyStatus.textContent = error
      ? getString("preferences-api-status-failed", {
          args: { message: error },
        })
      : valid
        ? getString("preferences-api-status-valid")
        : "";
  }

  private async recognizeExistingFormulae(): Promise<void> {
    this.existingFormulaController?.abort();
    const controller = new this.window.AbortController();
    this.existingFormulaController = controller;
    this.existingFormulaButton.setAttribute("disabled", "true");
    this.setExistingFormulaStatus(
      "running",
      getString("preferences-existing-formulae-scanning"),
    );
    try {
      const summary = await this.options.recognizeExistingFormulae(
        (progress) => this.renderExistingFormulaProgress(progress),
        controller.signal,
      );
      if (this.closed) return;
      if (summary.total === 0) {
        this.setExistingFormulaStatus(
          "success",
          getString("preferences-existing-formulae-empty"),
        );
        return;
      }
      this.setExistingFormulaStatus(
        summary.failed > 0 ? "failed" : "success",
        getString("preferences-existing-formulae-complete", {
          args: {
            failed: summary.failed,
            succeeded: summary.succeeded,
            total: summary.total,
          },
        }),
      );
    } catch (error) {
      if (this.closed) return;
      if (isCancellationError(error)) return;
      this.setExistingFormulaStatus(
        "failed",
        getString("preferences-existing-formulae-failed", {
          args: { message: localizeFormulaApiError(error) },
        }),
      );
    } finally {
      if (this.existingFormulaController === controller) {
        this.existingFormulaController = undefined;
        if (!this.closed) {
          this.existingFormulaButton.removeAttribute("disabled");
        }
      }
    }
  }

  private renderExistingFormulaProgress(
    progress: FormulaLatexBatchProgress,
  ): void {
    if (this.closed) return;
    if (progress.phase === "scanning") {
      this.setExistingFormulaStatus(
        "running",
        getString("preferences-existing-formulae-scanning"),
      );
      return;
    }
    if (progress.total === 0) return;
    this.setExistingFormulaStatus(
      "running",
      getString("preferences-existing-formulae-progress", {
        args: {
          completed: progress.completed,
          failed: progress.failed,
          succeeded: progress.succeeded,
          total: progress.total,
        },
      }),
    );
  }

  private setExistingFormulaStatus(state: string, text: string): void {
    this.existingFormulaStatus.setAttribute("data-state", state);
    this.existingFormulaStatus.removeAttribute("hidden");
    this.existingFormulaStatus.textContent = text;
  }

  private async prepareModel(force: boolean): Promise<void> {
    if (this.installController) {
      this.installController.abort();
      return;
    }

    const controller = new this.window.AbortController();
    this.installController = controller;
    this.refreshToken++;
    this.setBusy(true);
    this.restoreButton.setAttribute(
      "label",
      getString("preferences-cancel-install"),
    );
    this.setStatus("checking", getString("preferences-status-preparing"));
    try {
      const install = force
        ? modelManager.restoreRecommendedModel.bind(modelManager)
        : modelManager.ensureRecommendedModel.bind(modelManager);
      await install({
        onProgress: ({ loaded, percent, total }) => {
          if (this.closed) return;
          this.setStatus(
            "checking",
            getString("preferences-status-install-progress", {
              args: {
                loaded: formatFileSize(loaded),
                percent: percent === undefined ? "-" : Math.round(percent),
                total: total ? formatFileSize(total) : "-",
              },
            }),
          );
        },
        signal: controller.signal,
      });
      if (this.closed) return;
      await this.refresh(true);
    } catch (error) {
      if (this.closed) return;
      if (isCancellationError(error)) {
        this.setStatus(
          "checking",
          getString("preferences-status-install-cancelled"),
        );
      } else {
        this.setStatus(
          "invalid",
          getString("preferences-status-install-failed", {
            args: { message: toError(error).message },
          }),
        );
      }
    } finally {
      this.installController = undefined;
      if (!this.closed) {
        this.setBusy(false);
        this.resetRestoreLabel();
      }
    }
  }

  private async refresh(force = false): Promise<void> {
    const token = ++this.refreshToken;
    this.setStatus("checking", getString("preferences-status-checking"));
    try {
      const validation = await modelManager.validateConfiguredModel(force);
      if (this.closed || token !== this.refreshToken) return;
      this.renderValidation(validation);
    } catch (error) {
      if (this.closed || token !== this.refreshToken) return;
      this.setStatus(
        "invalid",
        getString("preferences-status-check-failed", {
          args: { message: toError(error).message },
        }),
      );
    }
  }

  private renderValidation(validation: ModelValidation): void {
    if (validation.state === "missing") {
      this.setStatusDetail(
        getString("preferences-model-expected", {
          args: {
            hash: shortHash(RECOMMENDED_MODEL.sha256),
            size: formatFileSize(RECOMMENDED_MODEL.size),
          },
        }),
      );
      this.setStatus("missing", getString("preferences-status-missing"));
      return;
    }

    if (validation.state === "invalid") {
      this.setStatusDetail(
        getString("preferences-model-invalid-details", {
          args: {
            hash: validation.actualHash
              ? shortHash(validation.actualHash)
              : getString("preferences-hash-not-computed"),
            size: formatFileSize(validation.size),
          },
        }),
      );
      this.setStatus("invalid", getString("preferences-status-invalid"));
      return;
    }

    const variantName = getString(validation.variant.labelKey);
    this.setStatusDetail(
      getString("preferences-model-valid-details", {
        args: {
          hash: shortHash(validation.hash),
          name: variantName,
          size: formatFileSize(validation.size),
        },
      }),
    );
    this.setStatus(
      "valid",
      getString("preferences-status-valid", { args: { name: variantName } }),
    );
  }

  private async revealModel(): Promise<void> {
    const path = modelManager.getConfiguredPath();
    if (await IOUtils.exists(path)) {
      await Zotero.File.reveal(path);
      return;
    }
    const directory = modelManager.getManagedDirectory();
    await IOUtils.makeDirectory(directory, {
      createAncestors: true,
      ignoreExisting: true,
    });
    await Zotero.File.reveal(directory);
  }

  private setBusy(busy: boolean): void {
    for (const element of [this.revealButton, this.verifyButton]) {
      element.toggleAttribute("disabled", busy);
    }
  }

  private setStatus(
    state: "checking" | "invalid" | "missing" | "valid",
    text: string,
  ): void {
    this.statusRow.setAttribute("data-state", state);
    this.status.textContent = text;
  }

  private setStatusDetail(text: string): void {
    this.statusRow.setAttribute("title", text);
    this.statusRow.setAttribute("tooltiptext", text);
  }

  private resetRestoreLabel(): void {
    this.restoreButton.setAttribute(
      "label",
      getString("preferences-restore-model"),
    );
  }
}

function requireElement<ElementType extends Element>(
  document: Document,
  selector: string,
): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing preference element: ${selector}`);
  return element;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function localizeFormulaApiError(value: unknown): string {
  if (!(value instanceof FormulaLatexServiceError)) {
    return getString("error-formula-api-failed");
  }
  switch (value.code) {
    case "missing-key":
      return getString("error-formula-api-key-missing");
    case "missing-model":
      return getString("error-formula-api-model-missing");
    case "invalid-url":
      return getString("error-formula-api-url-invalid");
    case "key-storage":
      return getString("error-formula-api-key-storage");
    case "http":
      return getString("error-formula-api-http", {
        args: { status: value.status ?? "-" },
      });
    case "network":
      return getString("error-formula-api-network");
    case "timeout":
      return getString("error-formula-api-timeout");
    case "invalid-response":
      return getString("error-formula-api-response");
  }
}
