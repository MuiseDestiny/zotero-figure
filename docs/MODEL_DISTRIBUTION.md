# Embedded Model Policy / 内置模型策略

## Decision

Zotero Figure ships exactly one runtime model inside the XPI: the optimized Q8 build. Users do not download a model separately and cannot accidentally select the larger FP32 variant.

| ID                      | Size       | SHA-256                                                            |
| ----------------------- | ---------- | ------------------------------------------------------------------ |
| `optimized-q8-6c25a56c` | 19,505,323 | `6c25a56caf796a074e26def15eea9018686836155fd9e15e5e0950e9c08a4cac` |

This file is derived from the upstream Q8 artifact with
`onnx.utils.extract_model(source, target, ["images"], ["output0"])`. The input
shape remains `[1, 3, 640, 640]`, the output remains `[1, 14, 8400]`, the ONNX
opset remains 12, and dynamic UINT8 quantization remains in place. Five-PDF,
15-page ONNX Runtime Web benchmarks produced bitwise-identical `output0`
tensors and identical final detections while reducing warm inference time by
3.67%.

The exact source artifact is `optimized-q8-d5d1e664`, 20,552,482 bytes, with
SHA-256 `d5d1e664fbe639e716be7011aa7493b40f4ab498374b2157988c2ea41bf70daf`.
The output-pruning step is the only model transformation applied after that Q8
artifact.

The source asset is stored at the `embeddedPath` declared in `model-manifest.json`. At runtime the plugin reads that local `chrome://` resource, writes a temporary copy, verifies exact size and SHA-256, then moves it to:

```text
Zotero.DataDirectory.dir/zotero-figure/models/
```

The installed copy is validated again before inference. Missing or corrupted copies are restored from the XPI without network access.

## Build Requirements

- The source tree and XPI must contain exactly one `.onnx` file.
- Its path, file name, byte size, SHA-256, and `quantized: true` flag must match `model-manifest.json`.
- `npm run build:check` and `npm run build` must fail when the model is missing or modified.
- A model update requires a new hash-bearing ID and file name, updated provenance, and a fresh quality comparison.
- Do not silently replace the bytes while retaining the same ID or file name.

## Distribution

Model accessibility is now the same as plugin accessibility because the model is part of `zotero-figure.xpi`. Publish the identical XPI through multiple channels:

- GitHub Releases for the canonical international release.
- A domestic object-storage, Gitee, ModelScope, or other accessible mirror.
- A `SHA256SUMS` file so users and maintainers can confirm that every mirror serves the same XPI.

The tradeoff is a larger plugin download and larger code-only updates. The benefit is deterministic inference, offline installation after the XPI is obtained, and no dependency on a model host.

## 中文结论

插件只使用内置的优化版 Q8 模型。用户安装 XPI 后不再单独下载模型，也不会误用 FP32。构建阶段和运行阶段都会按精确大小与 SHA-256 校验模型；本地副本丢失或损坏时直接从 XPI 恢复，不访问网络。地区可访问性通过“同一个 XPI 多渠道镜像”解决，而不是为模型单独维护下载源。
