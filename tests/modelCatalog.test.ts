import * as assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_VARIANTS,
  RECOMMENDED_MODEL,
  findModelVariant,
} from "../src/services/model/modelCatalog";

test("recognizes only model files with an approved size and SHA-256 pair", () => {
  for (const variant of MODEL_VARIANTS) {
    assert.equal(findModelVariant(variant.size, variant.sha256), variant);
    assert.equal(findModelVariant(variant.size + 1, variant.sha256), undefined);
    assert.equal(findModelVariant(variant.size, "0".repeat(64)), undefined);
  }
});

test("model manifest entries are versioned, unique, and well formed", () => {
  assert.equal(MODEL_VARIANTS.length, 1);
  assert.equal(RECOMMENDED_MODEL.quantized, true);
  assert.equal(
    RECOMMENDED_MODEL.embeddedPath.endsWith(RECOMMENDED_MODEL.fileName),
    true,
  );
  assert.equal(
    new Set(MODEL_VARIANTS.map(({ id }) => id)).size,
    MODEL_VARIANTS.length,
  );
  assert.equal(
    new Set(MODEL_VARIANTS.map(({ fileName }) => fileName)).size,
    MODEL_VARIANTS.length,
  );
  for (const variant of MODEL_VARIANTS) {
    assert.match(variant.id, /[a-f0-9]{8}$/);
    assert.match(variant.fileName, /\.onnx$/);
    assert.match(variant.embeddedPath, /^models\/.+\.onnx$/);
    assert.match(variant.sha256, /^[a-f0-9]{64}$/);
    assert.ok(variant.size > 0);
  }
});
