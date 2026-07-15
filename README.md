# Zotero Figure

Local figure, table, and formula extraction for Zotero PDFs.

[English](README.md) | [简体中文](docs/README.zh-CN.md) | [Italiano](docs/README.it-IT.md) | [Русский](docs/README.ru-RU.md) | [日本語](docs/README.ja-JP.md) | [Español](docs/README.es-ES.md)

[![Latest release](https://img.shields.io/github/v/release/MuiseDestiny/zotero-figure)](https://github.com/MuiseDestiny/zotero-figure/releases)
[![License](https://img.shields.io/github/license/MuiseDestiny/zotero-figure)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/MuiseDestiny/zotero-figure/latest/total)](https://github.com/MuiseDestiny/zotero-figure/releases)

Zotero Figure reads PDF attachments locally with MuPDF WASM, detects figures, tables, display formulae, captions, and table footnotes with DocLayout-YOLO, then presents the extracted images in a dedicated PDF-reader sidebar. Analysis does not require an open Reader, and the PDF and model inference remain on your computer.

> The detector can make mistakes. Please report plugin crashes, installation problems, or clearly reproducible integration bugs. Detection accuracy itself is primarily determined by the model.

## Features

- Detect figures, tables, and display formulae without uploading the PDF.
- Merge the nearest detected table footnote into the table crop and caption text.
- Read the attachment directly in a MuPDF WASM worker, extract page text, render 640 px detection images, and render high-resolution PNGs directly from detected PDF coordinates. Reader and future main-window batch workflows use the same local results.
- Ship the optimized Q8 model inside the XPI, verify the installed copy by exact file size and SHA-256, then transfer those verified bytes to the Worker for another SHA-256 check before inference.
- Store each attachment's result index as JSON and its extracted images as PNG files under the Zotero data directory.
- Reanalyze safely by replacing each page's local results or adding only missing results.
- Cancel long analyses; active inference Workers are terminated and rebuilt for later work. Detection stays at 640 px. Each uncached result is rendered directly from its PDF rectangle with a 2400 px target longest edge, up to 6x scale and 8 megapixels, without a high-resolution full-page canvas.
- Send pages without extractable text through the detector instead of skipping them. Text-bearing pages use tightened complete figure/table hints for English, Chinese, Italian, and Russian.
- Use the Zotero Figure icon in the PDF reader's left sidebar as the main and only entry point; the reader toolbar has no plugin button.
- Browse responsive result cards in PDF page order and then by visual position from top to bottom and left to right. Filter them as **All**, **Figures**, **Tables**, or **Formulae**, with each filter showing its result count. Local PNGs load near the viewport through revocable Blob URLs with at most three concurrent image reads.
- Keep long captions collapsed by default; click a caption to expand or collapse it.
- Analyze, cancel, add every result to a note, refresh, or clear local results from the sidebar action bar. Clearing empties the sidebar immediately, removes its JSON and PNG files in the background, and leaves existing Zotero annotation mirrors untouched.
- Follow Reader analysis directly in the sidebar through a percentage bar and localized stage text instead of a separate progress popup.
- When Zotero PDF Translate is installed, translate result captions from the action bar and toggle back to the originals. Successful translations are cached locally by target language and reused.
- Convert existing local results to Zotero annotation mirrors on demand from the action bar.
- Use each card's menu to copy, save, or pin the image, edit its caption, correct its crop on a draggable full-page preview, go to its page, add it to a note, or remove it. Manual crop corrections are rerendered at high resolution and survive repeated analysis.
- Optionally mirror results to native Zotero image annotations with `Figure N`, `Table N`, or `Formula N` tags and captions in their comments. This preference is off by default.
- Keep preferences focused on embedded-model maintenance and optional annotation synchronization; the synchronization explanation is available from a compact question-mark help icon.
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

Zotero Figure embeds one model: the output-pruned Q8 build `optimized-q8-6c25a56c` (19,505,323 bytes, SHA-256 `6c25a56caf796a074e26def15eea9018686836155fd9e15e5e0950e9c08a4cac`). It retains the exact `output0` tensor consumed by the plugin and removes seven unused output branches. The XPI copies it to the Zotero data directory under `zotero-figure/models/` and validates the installed copy before analysis.

Users never need GitHub, Hugging Face, or another model host after obtaining the XPI. To support restricted regions, publish the exact same XPI through both GitHub Releases and a domestic mirror, and verify both artifacts with the same SHA-256.

See [the model distribution policy](docs/MODEL_DISTRIBUTION.md) for build and mirror requirements.

## Usage

1. Open a PDF attachment in the Zotero reader.
2. Select the Zotero Figure icon in the reader's left sidebar. There is no Zotero Figure button in the top reader toolbar.
3. Select **Analyze figures, tables, and formulae** in the sidebar action bar, then wait for page rendering and detection to finish.
4. Switch between **All**, **Figures**, **Tables**, and **Formulae**. Use a card's menu to copy, save, pin, or correct its image, edit its caption, go to its page, add it to a note, or remove it.
5. If Zotero PDF Translate is installed, use the language button to translate captions; click it again to restore the originals.
6. Use **Add all results to a note**, **Refresh**, or **Clear local results** in the action bar when needed. Clearing affects only the plugin's local JSON and PNG files, not existing Zotero annotation mirrors.
7. To also create synchronized Zotero image annotations, enable **After analysis, also synchronize results to Zotero image annotations** in the plugin preferences. It is disabled by default.
8. For batch work, select one or more library items or PDF attachments, right-click, and use **PDF Figure > Analyze figures, tables, and formulae**, **Analyze figures, tables, and formulae and add to note**, or **Analyze figures, tables, and formulae and create annotations**. PDFs are processed sequentially and no Reader tab is required.

The sidebar always reads its own local result store. For each PDF attachment, metadata is saved in `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json` under the Zotero data directory, with PNG files in the adjacent `images/` directory. Manifest schema v5 stores manual caption and crop overrides, caption translations by target language, and versioned image-cache identities. Manual captions and crops survive repeated analysis because the detected values are retained separately for cache matching; editing a caption clears that result's stale translation cache. When a result has the same attachment-source fingerprint (file size and modification time, falling back to the Zotero item version), analysis version, model hash, preview version, result fingerprint, current crop fingerprint, and existing PNG, repeated analysis reuses that PNG. The manifest, translation caches, and PNG files do not use Zotero Sync. Enabling annotation synchronization creates an additional native-annotation mirror for syncing and interoperability; it does not change the sidebar's data source. Notes contain embedded image attachments rather than links to these local PNG paths, and clicking a note image still navigates to the corresponding source-PDF crop when annotation mirroring is disabled.

MuPDF, model, and Worker preparation is scheduled when the reader becomes idle. The first analysis can still be slower if it starts before preparation finishes. Runtime depends on PDF length, page complexity, CPU, and available memory.

During analysis, at most three pages are scheduled at once. Separate bounded stages allow at most two pages in detection, one MuPDF render request, one high-resolution region stage, and one storage operation. Detection pages use a 640 px longest edge. Uncached results are rendered directly from their PDF rectangles, one region at a time, with a 2400 px target longest edge, up to 6x scale and 8 megapixels. Two persistent ONNX Workers run concurrently with one inference thread each; cancellation terminates the affected Workers instead of leaving them consuming CPU. This duplicates the Q8 model session but removes the previous high-resolution full-page canvas. See [the memory analysis](docs/PERFORMANCE.md).

## Privacy

PDF parsing and rendering run with bundled MuPDF WASM; detection runs with Transformers.js and ONNX Runtime Web. Zotero Figure never sends PDF pages to a remote service and does not download a model at runtime.

Local result JSON and PNG files remain in the Zotero data directory. They leave the computer only if the user separately backs up or synchronizes that directory, or enables Zotero annotation synchronization for an additional copy of the results.

## Development

Node.js 20.10 or newer is required.

```bash
npm install
npm run check
npm run build
```

Useful commands:

| Command                    | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `npm run build:dev`        | Create an unpacked development build                         |
| `npm run build`            | Create `build/zotero-figure.xpi`                             |
| `npm run typecheck`        | Check TypeScript without emitting files                      |
| `npm run lint`             | Run ESLint without modifying source                          |
| `npm test`                 | Run domain, worker-pool, and locale tests                    |
| `npm run benchmark:models` | Compare ONNX models on identical real-PDF tensors            |
| `npm run check`            | Run all repository quality gates                             |
| `npm start`                | Build, launch the configured Zotero profile, and watch files |

Copy `scripts/zotero-cmd-default.json` to `scripts/zotero-cmd.json` and set the local Zotero binary, profile, and data paths before using `npm start`.

## Architecture

| Path                  | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `src/domain`          | Pure layout types, text reconstruction, and caption matching            |
| `src/features`        | Reader UI, library batch actions, and preferences                       |
| `src/services`        | Attachment analysis, MuPDF orchestration, inference, and result storage |
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
- [MuPDF.js](https://mupdf.readthedocs.io/en/latest/reference/javascript/)
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- The earlier [PDFFigures2](https://github.com/allenai/pdffigures2) integration, which established this plugin's original workflow

## License

[GNU Affero General Public License v3.0 or later](LICENSE)
