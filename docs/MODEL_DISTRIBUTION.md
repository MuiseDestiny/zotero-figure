# Embedded Model Policy / 内置模型策略

## Decision

Zotero Figure ships exactly one runtime model inside the XPI: the optimized Q8 build. Users do not download a model separately and cannot accidentally select the larger FP32 variant.

| ID                      | Size       | SHA-256                                                            |
| ----------------------- | ---------- | ------------------------------------------------------------------ |
| `optimized-q8-d5d1e664` | 20,552,482 | `d5d1e664fbe639e716be7011aa7493b40f4ab498374b2157988c2ea41bf70daf` |

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
