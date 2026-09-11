# Architecture

This document describes the current runtime architecture and the invariants that
must survive refactoring. It is a map for maintainers and coding agents, not a
replacement for the tests or `AGENTS.md`.

## Dependency direction

Keep dependencies flowing toward explicit boundaries:

```text
features -> services -> domain
    |          |
    +----------+-> platform/zotero
                   utils
```

| Area                   | Ownership                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain`           | Pure types and algorithms: layout matching, coordinate math, result identity, sidebar ordering, and card geometry. It must not use Zotero globals or the DOM.       |
| `src/platform/zotero`  | Narrow adapters for attachment files, Reader internals, annotations, tabs, navigation, and other Zotero APIs. Keep private compatibility types next to the adapter. |
| `src/services`         | Reusable orchestration: model preparation, PDF processing, ONNX workers, bounded concurrency, result persistence, gallery indexing, notes, and annotation output.   |
| `src/features`         | User workflows and UI controllers for the Reader sidebar, library batch actions, gallery, and preferences.                                                          |
| `src/utils`            | Small cross-cutting helpers for cancellation, localization, preferences, data URLs, and toolkit setup.                                                              |
| `addon/chrome/content` | Runtime workers, CSS, markup, gallery assets, model metadata, and the single embedded ONNX model.                                                                   |
| `scripts`              | Build, package, release, model comparison, and repository checks.                                                                                                   |

`src/index.ts` is the only place that installs browser globals on the plugin
sandbox. Resolve constructors from `Zotero.getMainWindow()` and fall back to
`Services.appShell.hiddenDOMWindow`. Do not add ad hoc `window.*` fallbacks in
business modules. Preserve the request permissions required by the registered
plugin APIs, including `allowRequestsFromUnsafeWebContent: true` where that API
bridge is configured.

## Runtime composition

`addon/bootstrap.js` loads the bundled script into the plugin sandbox.
`src/index.ts` establishes sandbox globals and creates the addon singleton.
`src/hooks.ts` owns startup and shutdown:

- one shared `FigureResultStore`, `LayoutAnalyzer`, `FigureGalleryIndex`, and
  `FigureBatchController` are used across main windows;
- each main window receives its own `FigureReaderController` and
  `FigureGalleryController`;
- Reader documents are released on `pagehide`, which also aborts their active
  analysis and disposes the injected sidebar;
- shutdown aborts/disposes controllers and workers, unregisters toolkit UI,
  and removes the addon singleton.

Sharing the analyzer is important: its permit pools bound work across concurrent
Readers as well as batch workflows. Batch attachments themselves are processed
sequentially.

## Core data and coordinates

The main domain contracts are:

- `LayoutElement`: one normalized detector output and its class/score.
- `PageLayoutData`: page text, geometry, and mapped detector elements.
- `AnnotationCandidate`: the detected result identity: page, PDF rectangle,
  tag, and extracted caption.
- `FigureResultRecord`: persisted result metadata, including optional detected
  values retained behind manual edits.
- `StoredFigureResult`: a record plus the resolved local PNG path.
- `FigureResultAnalysisIdentity`: analysis version, model hash, and preview
  renderer version used for cache invalidation.
- `PdfEngine` / `PdfAnalysisDocument`: the rendering and text-extraction
  boundary consumed by `LayoutAnalyzer`.

`Rect` always has the tuple shape `[minX, minY, maxX, maxY]`, but its coordinate
space is part of the surrounding type:

- `LayoutElement.xyxy` uses normalized image coordinates with a top-left
  origin.
- PDF characters, annotation candidates, and stored result rectangles use PDF
  user-space coordinates with a bottom-left origin and include ViewBox offsets.
- the region editor uses normalized page-preview coordinates with a top-left
  origin; `LayoutAnalyzer` converts these to and from PDF coordinates.

Do not convert coordinates by scaling width and height alone. Crop boxes,
rotation, and non-zero origins are handled through `pageBounds`, `viewBox`,
`pdfToPage`, and `pageToPdf` in `src/domain/pdfCoordinates.ts`.

## Analysis flow

`LayoutAnalyzer.analyzeAttachment` is the reusable workflow for both Reader and
headless library actions. A keyed analysis mutex covers the complete workflow,
so Reader windows and batch actions cannot analyze different revisions of the
same attachment concurrently; unrelated attachments still overlap.

1. Prepare MuPDF and validate/extract the embedded model in parallel. The
   installed model is accepted only when its size and SHA-256 match
   `model-manifest.json`.
2. Compute an attachment source fingerprint, prepare the ONNX worker pool, read
   the PDF once, and open a MuPDF worker document handle.
3. Walk page text in order. Text-bearing pages without figure, table, formula,
   or mathematical hints are skipped; pages without extractable text still go
   to detection.
4. Render a 640 px JPEG in the MuPDF worker. A layout worker decodes it,
   preprocesses a 640 x 640 tensor, runs the optimized Q8 model, filters
   relevant classes, and applies non-maximum suppression.
5. Map detector rectangles through the MuPDF page transform. Pure domain logic
   pairs figures/tables with captions, merges a nearby table footnote, associates
   formula labels, and emits `AnnotationCandidate` values.
6. Ask the result store whether every candidate and PNG on the page is reusable.
   A reusable page skips high-resolution rendering and image writes.
7. For an invalid cache, ask the store for page render candidates. Render each
   `renderRect` directly through MuPDF, while retaining its unchanged
   `detectedCandidate` for reconciliation. This distinction preserves a manual
   crop when only the source fingerprint or analysis identity invalidates its
   PNG.
8. Reconcile candidates and PNGs under the attachment lock. Optionally mirror
   the stored results to Zotero annotations after the local result commit.
9. After all scheduled pages settle, `replace-page` prunes results from pages
   skipped by the text heuristic and from page indices beyond the current PDF.
   `skip-existing` deliberately retains them.
10. Aggregate page outcomes and timing data, close the MuPDF document, and
    release every permit in `finally` blocks.

`LayoutAnalyzer` owns the workflow and permit ordering. Page timing state,
success/failure outcomes, cumulative counters, peak preview metrics, event-loop
responsiveness, and the structured completion log live in
`analysisTelemetry.ts`; add a metric there instead of duplicating fields in the
success, failure, and finalization branches.

The ONNX worker verifies the model bytes again before creating its session.
Remote models are disabled. PDF parsing, rendering, and inference remain local.

## Results and reconciliation

The sidebar and gallery use the local result store as their source of truth:

```text
<Zotero data>/zotero-figure/results/<libraryID>/<attachmentKey>/
  manifest.json
  images/<resultID>.png
```

The manifest owns result metadata, translation caches, analysis identity, and
per-image cache identity. A PNG is reusable only when all of these agree:

- attachment source fingerprint;
- analysis version, model hash, and preview version;
- detected result fingerprint;
- current crop fingerprint;
- referenced PNG existence.

`figureResultManifestCodec.ts` is the pure schema boundary: it validates and
normalizes persisted data, serializes the current schema, prunes translation
caches, and compares cache identities. `FigureResultStore` owns attachment
locks, filesystem paths, atomic manifest commits, PNG transactions, and
reconciliation. Keep schema rules out of the IO workflow and keep Zotero globals
out of the codec.

Result IDs and matching fingerprints come from detected values, not user
overrides. A manual caption stores the detector caption in `detectedComment`; a
manual crop stores the detector rectangle in `detectedRect`. The current
`comment` and `rect` remain the user-visible values. Reanalysis therefore keeps
an override when the detected fingerprint still matches. If the detector emits
a genuinely different identity, it is a new result and the old override is not
silently attached to it.

When a manual crop needs rerendering, `getPageRenderCandidates` pairs the
original detected candidate with the current user rectangle. The rendered PNG
and manifest rectangle must always describe the same crop. Reconciliation
checks the planned render rectangle against the latest stored rectangle before
overwriting a PNG; if the user corrected the region again during rendering,
the newer image and coordinates win and the stale cache remains invalid for a
later refresh.

Two duplicate policies are supported:

- `replace-page` reconciles the complete generated set for one page. Matching
  detected results retain manual overrides; obsolete page results are removed.
- `skip-existing` keeps existing results and adds only missing detected results.
  It may still rewrite an existing PNG when its cache identity is stale.

Never bypass the reconciliation APIs for repeated analysis. Zotero annotation
reconciliation must go through `reconcileGeneratedAnnotations`. Generated
annotations are recognized only when they are image annotations authored by
`zoterofigure` and tagged as `Figure`, `Table`, or `Formula`; destructive rules
must not be broadened casually.

## Persistence and failure semantics

Result operations are serialized by attachment key. Manifests are written to a
temporary file and atomically moved into place. Analysis and manual-correction
image writes are tracked until the owning manifest commits: cancellation or a
commit failure removes newly created PNGs and restores overwritten PNGs. A
failure to read an overwrite backup aborts before the current PNG is touched.
Unreadable, malformed, or invalid manifests are errors; treating them as empty
would turn corruption into silent data loss. Gallery refreshes publish a new
snapshot only after every indexed attachment has been read successfully, so a
transient manifest error leaves the preceding snapshot usable.

The manifest/PNG transaction does not include Zotero annotations or notes.
Local results commit before optional annotation mirroring, and notes are
independent snapshots with embedded images. Process termination can still
interrupt filesystem cleanup, so do not describe these resources as one atomic
transaction.

## UI request and image lifecycles

Reader sidebar and gallery images are loaded from local bytes through revocable
Blob URLs. Their bounded queues do not finish when `src` is assigned: they wait
for image load and decode, and cancellation must settle that wait before a queue
slot is reused. A remount, filter change, or newer gallery refresh invalidates
older generations so late file reads, localization, or decode callbacks cannot
commit stale DOM.

Pinned Reader cards keep independent Blob URLs and interaction state in
`pinnedFigureCardView.ts`. Refreshing a result with the same ID must replace its
snapshot in place without losing position or scale; the old URL remains valid
until the replacement is ready and is then revoked. Every image entry, observer,
timer, request generation, and Blob URL needs one explicit teardown owner.

## Cancellation and bounded work

Cancellation must remain observable as `OperationCancelledError`. Do not count
it as a failed page or wrap it in a generic analysis error. Abort signals flow
through model preparation, attachment reads, permit waits, MuPDF requests,
worker tasks, result locks, storage, and annotation reconciliation.

Cancelling active inference terminates the affected worker so it cannot keep
using CPU; later work rebuilds that worker. Annotation reconciliation rolls back
annotations created for the current page when cancellation or creation fails.
Filesystem reconciliation rolls back uncommitted image writes. Every acquired
permit, opened document, event listener, Blob URL, and worker must have an
explicit release path.

The current shared limits are documented in `docs/PERFORMANCE.md`:

| Resource                     | Limit |
| ---------------------------- | ----: |
| Scheduled pages              |     3 |
| Open PDF documents           |     2 |
| Detection pages              |     2 |
| ONNX workers                 |     2 |
| Threads per ONNX worker      |     1 |
| MuPDF render requests        |     1 |
| High-resolution region pages |     1 |
| Storage pages                |     1 |
| Annotation mirror pages      |     1 |

Detection uses a 640 px longest edge. Result rendering targets a 2,400 px
longest edge, is capped at 6x scale and 8,000,000 pixels, and renders regions
directly rather than retaining a high-resolution full-page canvas. Increasing
any limit requires a documented memory analysis, focused concurrency and
cancellation tests, and a real Zotero profile.

## Extension points

- Add pure detection matching or coordinate behavior in `src/domain`, with
  fixture-level tests that do not require Zotero.
- Add a PDF backend by implementing `PdfEngine`; keep attachment access in a
  Zotero adapter and keep `LayoutAnalyzer` independent of backend internals.
- Add a user workflow in `src/features`; reuse `LayoutAnalyzer`,
  `FigureResultStore`, and `FigureOutputService` rather than duplicating the
  pipeline.
- Put new Reader, annotation, main-tab, or item API usage in
  `src/platform/zotero` with narrow compatibility types and tests.
- Bump the result schema and add parsing/migration tests when persisted fields
  change. Revisit result and image fingerprints whenever a field affects
  identity or rendered pixels.
- Treat model replacement as a distribution change. Read
  `docs/MODEL_DISTRIBUTION.md` and verify provenance, input shape, opset,
  quantization, exact size, and SHA-256 before changing the manifest.
- Update all runtime Fluent locales together. Keep all six README translations
  aligned for requirements, installation, model, or user-visible behavior.

## Verification

Run the repository gates after relevant changes:

```bash
npm run format
npm run check
npm run build
unzip -t build/zotero-figure.xpi
git diff --check
```

Also inspect the built XPI: it must contain exactly one `.onnx` file, and its
path, byte size, and SHA-256 must match `model-manifest.json`. Confirm
`addon/manifest.json`, `scripts/update-template.json`, and generated
`update.json` targets Zotero `9.0` through `10.*`.

Use focused tests for the changed boundary: domain geometry, worker lifecycle,
permit cancellation, result rollback/cache invalidation, annotation
reconciliation, controller disposal, locale parity, and build contents all have
dedicated coverage. Do not claim real Zotero behavior as verified unless the
workflow was exercised in an actual Zotero 10 installation.
