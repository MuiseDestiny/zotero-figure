import manifest = require("../../../model-manifest.json");

export interface ModelVariant {
  embeddedPath: string;
  fileName: string;
  id: string;
  labelKey: string;
  quantized: boolean;
  sha256: string;
  size: number;
}

export const MODEL_NAME = manifest.modelName;
export const MODEL_MANAGED_DIRECTORY = manifest.managedDirectory;
export const MODEL_VARIANTS = manifest.variants as ModelVariant[];
export const RECOMMENDED_MODEL = getModelVariant(manifest.recommendedVariant);

export function getModelVariant(id: string): ModelVariant {
  const variant = MODEL_VARIANTS.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`Unknown model variant: ${id}`);
  return variant;
}

export function findModelVariant(
  size: number,
  sha256: string,
): ModelVariant | undefined {
  const normalizedHash = sha256.toLowerCase();
  return MODEL_VARIANTS.find(
    (variant) => variant.size === size && variant.sha256 === normalizedHash,
  );
}

export function formatFileSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}
