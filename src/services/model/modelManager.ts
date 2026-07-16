import { config } from "../../../package.json";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import {
  MODEL_MANAGED_DIRECTORY,
  MODEL_VARIANTS,
  RECOMMENDED_MODEL,
  findModelVariant,
  type ModelVariant,
} from "./modelCatalog";

export type ModelValidation =
  | { path: string; state: "missing" }
  | {
      actualHash?: string;
      path: string;
      size: number;
      state: "invalid";
    }
  | {
      hash: string;
      path: string;
      size: number;
      state: "valid";
      variant: ModelVariant;
    };

export interface ModelInstallProgress {
  loaded: number;
  percent?: number;
  total?: number;
}

interface CacheEntry {
  lastModified?: number;
  size?: number;
  validation: ModelValidation;
}

interface ModelInstallProgressSubscription {
  notify(progress: ModelInstallProgress): void;
}

export class ModelManager {
  private readonly installProgressSubscriptions =
    new Set<ModelInstallProgressSubscription>();
  private installPromise?: Promise<ModelValidation>;
  private readonly validationCache = new Map<string, CacheEntry>();

  public getManagedDirectory(): string {
    return PathUtils.join(
      Zotero.DataDirectory.dir,
      ...MODEL_MANAGED_DIRECTORY.split("/"),
    );
  }

  public getRecommendedPath(): string {
    return PathUtils.join(
      this.getManagedDirectory(),
      RECOMMENDED_MODEL.fileName,
    );
  }

  public getConfiguredPath(): string {
    return this.getRecommendedPath();
  }

  public async validateConfiguredModel(
    force = false,
  ): Promise<ModelValidation> {
    return this.validate(this.getConfiguredPath(), force);
  }

  public async validate(path: string, force = false): Promise<ModelValidation> {
    if (!(await IOUtils.exists(path))) return { path, state: "missing" };
    const fileInfo = await IOUtils.stat(path);
    const cached = this.validationCache.get(path);
    if (
      cached &&
      !force &&
      cached.lastModified === fileInfo.lastModified &&
      cached.size === fileInfo.size
    ) {
      return cached.validation;
    }

    const size = fileInfo.size ?? 0;
    const sizeMatches = MODEL_VARIANTS.some((variant) => variant.size === size);
    if (!sizeMatches) {
      const validation: ModelValidation = { path, size, state: "invalid" };
      this.cache(path, fileInfo, validation);
      return validation;
    }

    const hash = (await IOUtils.computeHexDigest(path, "sha256")).toLowerCase();
    const variant = findModelVariant(size, hash);
    const validation: ModelValidation = variant
      ? { hash, path, size, state: "valid", variant }
      : { actualHash: hash, path, size, state: "invalid" };
    this.cache(path, fileInfo, validation);
    return validation;
  }

  public async ensureRecommendedModel(
    options: {
      onProgress?: (progress: ModelInstallProgress) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<ModelValidation> {
    throwIfAborted(options.signal);
    const validation = await this.validateConfiguredModel();
    throwIfAborted(options.signal);
    if (
      validation.state === "valid" &&
      validation.variant.id === RECOMMENDED_MODEL.id
    ) {
      return validation;
    }
    return this.prepareRecommendedModel(options);
  }

  public async restoreRecommendedModel(
    options: {
      onProgress?: (progress: ModelInstallProgress) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<ModelValidation> {
    throwIfAborted(options.signal);
    return this.prepareRecommendedModel(options);
  }

  private async prepareRecommendedModel(options: {
    onProgress?: (progress: ModelInstallProgress) => void;
    signal?: AbortSignal;
  }): Promise<ModelValidation> {
    throwIfAborted(options.signal);
    const onProgress = options.onProgress;
    const progressSubscription = onProgress
      ? { notify: (progress: ModelInstallProgress) => onProgress(progress) }
      : undefined;
    if (progressSubscription) {
      this.installProgressSubscriptions.add(progressSubscription);
    }
    try {
      return await waitForModelInstall(
        this.getOrStartInstall(),
        options.signal,
      );
    } finally {
      if (progressSubscription) {
        this.installProgressSubscriptions.delete(progressSubscription);
      }
    }
  }

  private getOrStartInstall(): Promise<ModelValidation> {
    if (this.installPromise) return this.installPromise;
    const operation = this.installRecommendedModel();
    this.installPromise = operation;
    const finish = () => {
      if (this.installPromise === operation) this.installPromise = undefined;
    };
    void operation.then(finish, finish);
    return operation;
  }

  private async installRecommendedModel(): Promise<ModelValidation> {
    const sourceURL = `chrome://${config.addonRef}/content/${RECOMMENDED_MODEL.embeddedPath}`;

    const directory = this.getManagedDirectory();
    const destination = this.getRecommendedPath();
    const temporaryPath = `${destination}.part`;
    await IOUtils.makeDirectory(directory, {
      createAncestors: true,
      ignoreExisting: true,
    });
    if (await IOUtils.exists(temporaryPath))
      await IOUtils.remove(temporaryPath);

    try {
      const response = await Zotero.HTTP.request("GET", sourceURL, {
        requestObserver: (request: XMLHttpRequest) => {
          request.addEventListener("progress", (event) => {
            const total = event.lengthComputable ? event.total : undefined;
            this.reportInstallProgress({
              loaded: event.loaded,
              percent: total ? (event.loaded / total) * 100 : undefined,
              total,
            });
          });
        },
        responseType: "arraybuffer",
        timeout: 0,
      });

      const bytes = new Uint8Array(response.response as ArrayBuffer);
      await IOUtils.write(temporaryPath, bytes, { flush: true });
      const validation = await this.validate(temporaryPath, true);
      if (
        validation.state !== "valid" ||
        validation.variant.id !== RECOMMENDED_MODEL.id
      ) {
        throw new Error("Bundled model failed integrity validation");
      }

      await IOUtils.move(temporaryPath, destination, { noOverwrite: false });
      this.validationCache.delete(temporaryPath);
      this.validationCache.delete(destination);
      return this.validate(destination, true);
    } finally {
      try {
        if (await IOUtils.exists(temporaryPath)) {
          await IOUtils.remove(temporaryPath);
        }
      } catch (cleanupError) {
        Zotero.logError(toError(cleanupError));
      }
    }
  }

  private reportInstallProgress(progress: ModelInstallProgress): void {
    for (const subscription of this.installProgressSubscriptions) {
      try {
        subscription.notify(progress);
      } catch (error) {
        Zotero.logError(toError(error));
      }
    }
  }

  private cache(
    path: string,
    fileInfo: FileInfo,
    validation: ModelValidation,
  ): void {
    this.validationCache.set(path, {
      lastModified: fileInfo.lastModified,
      size: fileInfo.size,
      validation,
    });
  }
}

export const modelManager = new ModelManager();

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function waitForModelInstall(
  operation: Promise<ModelValidation>,
  signal?: AbortSignal,
): Promise<ModelValidation> {
  throwIfAborted(signal);
  if (!signal) return operation;
  return new Promise<ModelValidation>((resolve, reject) => {
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (settle()) reject(new OperationCancelledError());
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (validation) => {
        if (settle()) resolve(validation);
      },
      (error) => {
        if (settle()) reject(toError(error));
      },
    );
  });
}
