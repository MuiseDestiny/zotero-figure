# Repository Guidance

These instructions apply to the entire repository.

## Architecture

- Keep pure layout types and algorithms in `src/domain` without Zotero globals.
- Put reader and annotation API boundaries in `src/platform/zotero`.
- Put user workflows in `src/features` and reusable orchestration in `src/services`.
- Keep private Zotero API compatibility types narrow and next to the adapter that uses them.
- Prefer explicit data types and small named helpers over cross-module global state.

## Required Invariants

- Support Zotero 9 only. Keep source manifests, update templates, documentation, and build checks aligned with `9.0` through `9.*`.
- The optimized Q8 ONNX model is embedded in the XPI and is the only runtime model. Its path, exact byte size, and SHA-256 must match `model-manifest.json`.
- Keep analysis cancellation observable as `OperationCancelledError`; do not convert cancellation into a failed page.
- Keep page rendering and inference bounded. Increasing pipeline depth requires a documented memory analysis and focused tests.
- Repeated analysis must go through `reconcileGeneratedAnnotations`. Preserve both `replace-page` and `skip-existing` behavior and rollback newly created annotations on cancellation or failure.
- Generated annotations are identified by both the `zoterofigure` author and a `Figure`, `Table`, or `Formula` tag. Do not broaden destructive deletion rules casually.
- Update all runtime Fluent locales (`en-US`, `zh-CN`, `it-IT`, `ru-RU`) together. Preserve identical message keys and variables.
- Keep all six README translations aligned when requirements, installation, model handling, or user-visible behavior changes.

## Model Changes

- Verify model provenance, input shape, byte size, SHA-256, ONNX opset, and quantization mode before editing `model-manifest.json`.
- Keep the embedded model file name immutable and include its short hash.
- Extract the bundled model under `Zotero.DataDirectory.dir/zotero-figure/models/` and validate it again before inference.
- Read `docs/MODEL_DISTRIBUTION.md` before changing model storage or download behavior.

## Verification

Run these commands after relevant changes:

```bash
npm run format
npm run check
npm run build
unzip -t build/zotero-figure.xpi
git diff --check
```

Confirm the XPI contains exactly one `.onnx` file with the manifest size and SHA-256, and that `update.json` still targets Zotero 9 only. Real Zotero behavior must not be claimed as verified unless it was exercised on an actual Zotero 9 installation.
