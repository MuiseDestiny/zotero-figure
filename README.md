# Zotero Figure

Extract figures, tables, and formulae from Zotero PDFs.

[English](README.md) | [简体中文](docs/README.zh-CN.md) | [Italiano](docs/README.it-IT.md) | [Русский](docs/README.ru-RU.md) | [日本語](docs/README.ja-JP.md) | [Español](docs/README.es-ES.md)

[![Latest release](https://img.shields.io/github/v/release/MuiseDestiny/zotero-figure)](https://github.com/MuiseDestiny/zotero-figure/releases)
[![License](https://img.shields.io/github/license/MuiseDestiny/zotero-figure)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/MuiseDestiny/zotero-figure/latest/total)](https://github.com/MuiseDestiny/zotero-figure/releases)

Zotero Figure detects PDF figures, tables, display formulae, captions, and table footnotes. PDF reading, rendering, and layout detection run locally with the model bundled in the plugin.

## Features

- Analyze PDFs locally without uploading pages or downloading a model at runtime.
- Review results in a dedicated Reader sidebar with type filters and analysis progress.
- Copy, save, or pin an image; edit its caption or crop; open its PDF page; add it to a note; or remove it.
- Browse results from multiple documents in **PDF Figure Library**, with library, document, year, category, type, and caption filters.
- Batch-analyze selected library items or PDF attachments, with optional note or Zotero annotation output.
- Translate captions when Zotero PDF Translate is installed.
- Optionally recognize formula LaTeX with SiliconFlow `Qwen/Qwen3.6-35B-A3B`, render it locally with KaTeX, and copy, re-recognize, or edit it with Zotero's Monaco editor.
- Create Zotero notes with embedded PNG images that link back to the source PDF.
- Optionally mirror local results to Zotero image annotations for synchronization and interoperability.
- Use the interface in English, Simplified Chinese, Italian, or Russian.

## Requirements

- Zotero 9.
- The Zotero Figure XPI from the [latest release](https://github.com/MuiseDestiny/zotero-figure/releases/latest).
- Formula OCR only: network access and a SiliconFlow API key.

Java and `pdffigures2.jar` are not required.

## Installation

1. Download `zotero-figure.xpi` from the latest release.
2. In Zotero, open `Tools > Plugins`, choose **Install Plugin From File...**, and select the XPI.
3. Restart Zotero if requested.

## Entry Points

- **PDF Reader:** Open a PDF, select the Zotero Figure icon in the left sidebar, and choose **Analyze figures, tables, and formulae**.
- **Figure Library:** Open `Tools > PDF Figure Library` to browse results across documents. Select a card to open its source PDF.
- **Batch Processing:** Select library items or PDF attachments, right-click, and open `PDF Figure >` to analyze them, add results to notes, or create annotations.
- **Preferences:** Open the PDF Figure preferences pane to manage the bundled model, annotation synchronization, and SiliconFlow formula OCR. Use **Convert existing formulae** to recognize uncached formulae across libraries.

## Privacy

PDF parsing, rendering, layout detection, and local result storage stay on your computer. Local results do not use Zotero Sync unless you enable annotation mirroring.

Formula OCR is optional. API-key checking sends a text-only request to SiliconFlow. Formula recognition sends formula PNG crops, never full PDF pages; the key is stored in local Zotero preferences. SiliconFlow usage may incur charges.

## Links

- [Releases](https://github.com/MuiseDestiny/zotero-figure/releases)
- [Issues](https://github.com/MuiseDestiny/zotero-figure/issues)
- [AGPL-3.0-or-later license](LICENSE)
