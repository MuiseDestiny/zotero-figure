# Zotero Figure

Local figure and table extraction for Zotero PDFs.

[English](README.md) | [简体中文](docs/README.zh-CN.md) | [Italiano](docs/README.it-IT.md) | [Русский](docs/README.ru-RU.md) | [日本語](docs/README.ja-JP.md) | [Español](docs/README.es-ES.md)

[![Latest release](https://img.shields.io/github/v/release/MuiseDestiny/zotero-figure)](https://github.com/MuiseDestiny/zotero-figure/releases)
[![License](https://img.shields.io/github/license/MuiseDestiny/zotero-figure)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/MuiseDestiny/zotero-figure/latest/total)](https://github.com/MuiseDestiny/zotero-figure/releases)

Zotero Figure renders PDF pages locally, detects figures, tables, and their captions with DocLayout-YOLO, then presents the extracted images in a dedicated PDF-reader sidebar. The PDF and model inference remain on your computer.

> The detector can make mistakes. Please report plugin crashes, installation problems, or clearly reproducible integration bugs. Detection accuracy itself is primarily determined by the model.

## Features

- Detect figures and tables without uploading the PDF.
- Ship the optimized Q8 model inside the XPI, verify the installed copy by exact file size and SHA-256, then transfer those verified bytes to the Worker for another SHA-256 check before inference.
- Store each attachment's result index as JSON and its extracted images as PNG files under the Zotero data directory.
- Reanalyze safely by replacing each page's local results or adding only missing results.
- Cancel long analyses; an active cancellation terminates the current inference Worker and rebuilds it for later work. Detection stays at 640 px. Each result page is rendered once at up to 4x, 12 megapixels, and 8192 px per side, then all detected rectangles are cropped from that page image.
- Send pages without extractable text through the detector instead of skipping them. Text-bearing pages use tightened complete figure/table hints for English, Chinese, Italian, and Russian.
- Use the Zotero Figure icon in the PDF reader's left sidebar as the main and only entry point; the reader toolbar has no plugin button.
- Browse responsive result cards and filter them in the order **All**, **Figures**, and **Tables**, with each filter showing its result count. Local PNGs load near the viewport through revocable Blob URLs with at most three concurrent image reads.
- Keep long captions collapsed by default; click a caption to expand or collapse it.
- Analyze, cancel, add every result to a note, refresh, or clear local results from the sidebar action bar. Clearing empties the sidebar immediately, removes its JSON and PNG files in the background, and leaves existing Zotero annotation mirrors untouched.
- When Zotero PDF Translate is installed, translate figure and table captions from the action bar and toggle back to the originals. Successful translations are cached locally by target language and reused.
- Convert existing local results to Zotero annotation mirrors on demand from the action bar.
- Use each card's menu to copy or save the image, go to its page, add it to a note, or remove it.
- Optionally mirror results to native Zotero image annotations with `Figure N` or `Table N` tags and captions in their comments. This preference is off by default.
- Create Zotero notes with real embedded PNG attachments, either for one card or for all current results. Each note image remains clickable and navigates to the corresponding crop in the source PDF without requiring an annotation mirror.
- Use the interface in English, Simplified Chinese, Italian, or Russian.

## Requirements

- Zotero 9 only.
- The Zotero Figure XPI from the [latest release](https://github.com/MuiseDestiny/zotero-figure/releases/latest).

Java and `pdffigures2.jar` are no longer required by the current local inference pipeline.

## Installation

1. Download `zotero-figure.xpi` from the latest release.
2. In Zotero, open `Tools > Plugins`, choose `Install Plugin From File...`, and select the XPI.
3. Open a PDF, select the Zotero Figure icon in the reader's left sidebar, and start analysis. The bundled model is prepared and verified automatically; no separate model download is required.

## Embedded Model

Zotero Figure embeds one model: the optimized Q8 build `optimized-q8-d5d1e664` (20,552,482 bytes, SHA-256 `d5d1e664fbe639e716be7011aa7493b40f4ab498374b2157988c2ea41bf70daf`). The XPI copies it to the Zotero data directory under `zotero-figure/models/` and validates the installed copy before analysis.

Users never need GitHub, Hugging Face, or another model host after obtaining the XPI. To support restricted regions, publish the exact same XPI through both GitHub Releases and a domestic mirror, and verify both artifacts with the same SHA-256.

See [the model distribution policy](docs/MODEL_DISTRIBUTION.md) for build and mirror requirements.

## Usage

1. Open a PDF attachment in the Zotero reader.
2. Select the Zotero Figure icon in the reader's left sidebar. There is no Zotero Figure button in the top reader toolbar.
3. Select **Analyze figures and tables** in the sidebar action bar, then wait for page rendering and detection to finish.
4. Switch between **All**, **Figures**, and **Tables**. Use a card's menu to copy or save its image, go to its page, add it to a note, or remove it.
5. If Zotero PDF Translate is installed, use the language button to translate captions; click it again to restore the originals.
6. Use **Add all results to a note**, **Refresh**, or **Clear local results** in the action bar when needed. Clearing affects only the plugin's local JSON and PNG files, not existing Zotero annotation mirrors.
7. To also create synchronized Zotero image annotations, enable **After analysis, also synchronize results to Zotero image annotations** in the plugin preferences. It is disabled by default.

The sidebar always reads its own local result store. For each PDF attachment, metadata is saved in `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json` under the Zotero data directory, with PNG files in the adjacent `images/` directory. Manifest schema v3 stores caption translations by target language and versioned image-cache identities. When a result has the same attachment-source fingerprint (file size and modification time, falling back to the Zotero item version), analysis version, model hash, preview version, and result fingerprint, and its PNG still exists, repeated analysis reuses that PNG. The manifest, translation caches, and PNG files do not use Zotero Sync. Enabling annotation synchronization creates an additional native-annotation mirror for syncing and interoperability; it does not change the sidebar's data source. Notes contain embedded image attachments rather than links to these local PNG paths, and clicking a note image still navigates to the corresponding source-PDF crop when annotation mirroring is disabled.

Model and Worker preparation is scheduled when the reader becomes idle. The first analysis can still be slower if it starts before preparation finishes. Runtime depends on PDF length, page complexity, CPU, and available memory.

During analysis, at most three pages are scheduled at once. Separate bounded stages allow at most two pages in detection, one detection-page render, one high-resolution preview page, and one storage operation. Detection pages render at 640 px. For an uncached result page, the PDF is rendered once at no more than 4x scale, 12 megapixels, or 8192 px per side, and all result rectangles are cropped from that single page image. One inference Worker is reused and may use up to four WASM threads while reserving logical capacity for Zotero; cancelling active inference terminates that Worker instead of leaving it consuming CPU. Reusing one Worker avoids duplicate model sessions.

## Privacy

Detection runs inside Zotero with Transformers.js and ONNX Runtime Web. Zotero Figure never sends PDF pages to a remote inference service and does not download a model at runtime.

Local result JSON and PNG files remain in the Zotero data directory. They leave the computer only if the user separately backs up or synchronizes that directory, or enables Zotero annotation synchronization for an additional copy of the results.

## Development

Node.js 20.10 or newer is required.

```bash
npm install
npm run check
npm run build
```

Useful commands:

| Command             | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `npm run build:dev` | Create an unpacked development build                         |
| `npm run build`     | Create `build/zotero-figure.xpi`                             |
| `npm run typecheck` | Check TypeScript without emitting files                      |
| `npm run lint`      | Run ESLint without modifying source                          |
| `npm test`          | Run domain, worker-pool, and locale tests                    |
| `npm run check`     | Run all repository quality gates                             |
| `npm start`         | Build, launch the configured Zotero profile, and watch files |

Copy `scripts/zotero-cmd-default.json` to `scripts/zotero-cmd.json` and set the local Zotero binary, profile, and data paths before using `npm start`.

## Architecture

| Path                  | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `src/domain`          | Pure layout types, text reconstruction, and caption matching            |
| `src/features`        | Reader UI and preferences                                               |
| `src/services`        | Page analysis, queued inference, image cropping, and local result store |
| `src/platform/zotero` | Typed boundaries around Zotero reader and annotation APIs               |
| `src/utils`           | Localization, preferences, and toolkit setup                            |
| `addon`               | Bootstrap, Fluent translations, worker code, icons, and model metadata  |
| `scripts`             | Reproducible build, development server, and quality checks              |
| `tests`               | Node-based tests for code that can run outside Zotero                   |

Keep domain logic independent of Zotero globals. New private Zotero API usage should be isolated under `src/platform/zotero` or in one feature adapter, with the narrowest practical compatibility type.

## Current Limitations

The prioritized maintenance backlog is in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). The most important remaining gaps are caption extraction from scanned PDFs, private Zotero reader API risk, and end-to-end testing on a real Zotero 9 installation.

## Credits

- [DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO)
- [Transformers.js](https://github.com/huggingface/transformers.js)
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- The earlier [PDFFigures2](https://github.com/allenai/pdffigures2) integration, which established this plugin's original workflow

## License

[GNU Affero General Public License v3.0 or later](LICENSE)
