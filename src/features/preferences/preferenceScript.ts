import { config } from "../../../package.json";
import {
  formatFileSize,
  RECOMMENDED_MODEL,
  shortHash,
} from "../../services/model/modelCatalog";
import {
  modelManager,
  type ModelValidation,
} from "../../services/model/modelManager";
import { isCancellationError } from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";

let preferencePaneID: string | undefined;
const controllers = new WeakMap<Window, ModelPreferencesController>();

export async function registerPrefs(): Promise<void> {
  if (preferencePaneID) return;
  preferencePaneID = await Zotero.PreferencePanes.register({
    helpURL: "https://github.com/MuiseDestiny/zotero-figure#installation",
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    label: config.addonName,
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
  });
}

export function registerPrefsScripts(window: Window): void {
  if (controllers.has(window)) return;
  const controller = new ModelPreferencesController(window);
  controllers.set(window, controller);
  controller.start();
}

class ModelPreferencesController {
  private closed = false;
  private readonly duplicateMode: HTMLSelectElement;
  private readonly syncAnnotations: Element & { checked: boolean };
  private installController?: AbortController;
  private readonly metadata: Element;
  private readonly revealButton: Element;
  private refreshToken = 0;
  private readonly restoreButton: Element;
  private readonly status: Element;
  private readonly statusRow: Element;
  private readonly storagePath: Element;
  private readonly verifyButton: Element;

  constructor(private readonly window: Window) {
    const doc = window.document;
    this.duplicateMode = requireElement(doc, "#duplicate-mode");
    this.syncAnnotations = requireElement(doc, "#sync-annotations");
    this.metadata = requireElement(doc, "#model-metadata");
    this.revealButton = requireElement(doc, "#reveal-model");
    this.restoreButton = requireElement(doc, "#restore-model");
    this.status = requireElement(doc, "#model-status");
    this.statusRow = requireElement(doc, "#model-status-row");
    this.storagePath = requireElement(doc, "#managed-model-path");
    this.verifyButton = requireElement(doc, "#verify-model");
  }

  public start(): void {
    this.restoreButton.addEventListener("command", () => {
      void this.prepareModel(true);
    });
    this.verifyButton.addEventListener("command", () => {
      void this.refresh(true);
    });
    this.revealButton.addEventListener("command", () => {
      void this.revealModel();
    });
    this.duplicateMode.addEventListener("change", () => {
      const value = this.duplicateMode.value;
      setPref(
        "duplicateMode",
        value === "skip-existing" ? "skip-existing" : "replace-page",
      );
    });
    this.syncAnnotations.addEventListener("command", () => {
      setPref("syncAnnotations", this.syncAnnotations.checked);
    });
    this.window.addEventListener(
      "unload",
      () => {
        this.closed = true;
        this.refreshToken++;
        this.installController?.abort();
      },
      { once: true },
    );
    this.storagePath.textContent = modelManager.getManagedDirectory();
    this.duplicateMode.value =
      getPref("duplicateMode") === "skip-existing"
        ? "skip-existing"
        : "replace-page";
    this.syncAnnotations.checked = getPref("syncAnnotations") === true;
    this.resetRestoreLabel();
    void this.prepareModel(false);
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
      this.metadata.textContent = getString("preferences-model-expected", {
        args: {
          hash: shortHash(RECOMMENDED_MODEL.sha256),
          size: formatFileSize(RECOMMENDED_MODEL.size),
        },
      });
      this.setStatus("missing", getString("preferences-status-missing"));
      return;
    }

    if (validation.state === "invalid") {
      this.metadata.textContent = getString(
        "preferences-model-invalid-details",
        {
          args: {
            hash: validation.actualHash
              ? shortHash(validation.actualHash)
              : getString("preferences-hash-not-computed"),
            size: formatFileSize(validation.size),
          },
        },
      );
      this.setStatus("invalid", getString("preferences-status-invalid"));
      return;
    }

    const variantName = getString(validation.variant.labelKey);
    this.metadata.textContent = getString("preferences-model-valid-details", {
      args: {
        hash: shortHash(validation.hash),
        name: variantName,
        size: formatFileSize(validation.size),
      },
    });
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
