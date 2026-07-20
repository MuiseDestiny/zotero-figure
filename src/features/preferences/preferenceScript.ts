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
  validateSiliconFlowApiKey,
} from "../../services/formula/formulaLatexService";
import type {
  FormulaLatexBatchProgress,
  FormulaLatexBatchSummary,
} from "../../services/formula/formulaLatexCoordinator";
import { isCancellationError } from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";

const SILICONFLOW_API_KEY_URL = "https://cloud.siliconflow.cn/i/3Xa4I0X8";

let preferencePaneID: string | undefined;
const controllers = new WeakMap<Window, ModelPreferencesController>();

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
  controller.start();
}

class ModelPreferencesController {
  private readonly aboutVersion: Element;
  private readonly apiKeyInput: HTMLInputElement;
  private readonly apiKeyStatus: Element;
  private readonly apiKeyVerifyButton: Element;
  private apiValidationController?: AbortController;
  private apiValidationToken = 0;
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
    this.aboutVersion = requireElement(doc, "#about-version");
    this.apiKeyInput = requireElement(doc, "#siliconflow-api-key");
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

  public start(): void {
    this.aboutVersion.textContent = getString("preferences-about-version", {
      args: { version },
    });
    this.apiKeyInput.addEventListener("input", () => {
      this.apiValidationController?.abort();
      this.apiValidationController = undefined;
      this.existingFormulaController?.abort();
      this.existingFormulaController = undefined;
      setPref("siliconFlowApiKey", this.apiKeyInput.value);
      setPref("siliconFlowApiKeyValidated", false);
      setPref("autoRecognizeFormula", false);
      this.autoRecognizeFormula.checked = false;
      this.apiValidationToken++;
      this.apiKeyVerifyButton.removeAttribute("disabled");
      this.existingFormulaButton.removeAttribute("disabled");
      this.renderApiValidation(false);
    });
    this.apiKeyVerifyButton.addEventListener("command", () => {
      void this.verifyApiKey();
    });
    this.getApiKeyButton.addEventListener("command", () => {
      Zotero.launchURL(SILICONFLOW_API_KEY_URL);
    });
    this.openGalleryButton.addEventListener("command", () => {
      this.options.openGallery();
    });
    this.autoRecognizeFormula.addEventListener("command", () => {
      setPref("autoRecognizeFormula", this.autoRecognizeFormula.checked);
    });
    this.existingFormulaButton.addEventListener("command", () => {
      void this.recognizeExistingFormulae();
    });
    this.restoreButton.addEventListener("command", () => {
      void this.prepareModel(true);
    });
    this.verifyButton.addEventListener("command", () => {
      void this.refresh(true);
    });
    this.revealButton.addEventListener("command", () => {
      void this.revealModel();
    });
    this.syncAnnotations.addEventListener("command", () => {
      setPref("syncAnnotations", this.syncAnnotations.checked);
    });
    this.window.addEventListener(
      "unload",
      () => {
        this.closed = true;
        this.refreshToken++;
        this.apiValidationToken++;
        this.apiValidationController?.abort();
        this.existingFormulaController?.abort();
        this.installController?.abort();
      },
      { once: true },
    );
    this.syncAnnotations.checked = getPref("syncAnnotations") === true;
    this.apiKeyInput.value = getPref("siliconFlowApiKey") ?? "";
    this.autoRecognizeFormula.checked =
      getPref("autoRecognizeFormula") === true;
    this.renderApiValidation(
      getPref("siliconFlowApiKeyValidated") === true &&
        Boolean(this.apiKeyInput.value.trim()),
    );
    this.resetRestoreLabel();
    void this.prepareModel(false);
  }

  private async verifyApiKey(): Promise<void> {
    this.apiValidationController?.abort();
    const controller = new this.window.AbortController();
    this.apiValidationController = controller;
    const token = ++this.apiValidationToken;
    const key = this.apiKeyInput.value;
    this.apiKeyVerifyButton.setAttribute("disabled", "true");
    this.apiKeyStatus.setAttribute("data-state", "checking");
    this.apiKeyStatus.textContent = getString(
      "preferences-api-status-checking",
    );
    try {
      await validateSiliconFlowApiKey(key, { signal: controller.signal });
      if (this.closed || token !== this.apiValidationToken) return;
      setPref("siliconFlowApiKeyValidated", true);
      this.renderApiValidation(true);
    } catch (error) {
      if (this.closed || token !== this.apiValidationToken) return;
      setPref("siliconFlowApiKeyValidated", false);
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
