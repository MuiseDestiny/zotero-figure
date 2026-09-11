# Analysis performance budget

Zotero Figure optimizes for a responsive Zotero window while allowing batch
analysis without an open Reader. PDF work runs in one MuPDF WASM worker, and
inference runs in two ONNX workers with one inference thread each. Every stage
has an explicit bound.

## Pipeline limits

| Resource                     | Limit | Purpose                                                           |
| ---------------------------- | ----: | ----------------------------------------------------------------- |
| Scheduled pages              |     3 | Bounds buffers retained by unfinished pages                       |
| Open PDF documents           |     2 | Bounds PDF bytes and MuPDF document state during batch analysis   |
| Detection pages              |     2 | Keeps both ONNX workers fed without an unbounded image queue      |
| ONNX workers                 |     2 | Runs two detections concurrently                                  |
| Threads per ONNX worker      |     1 | Avoids nested WASM thread contention and leaves Zotero responsive |
| MuPDF render requests        |     1 | Serializes rendering in the single PDF worker                     |
| High-resolution region pages |     1 | Bounds display-list and encoded-region lifetime                   |
| Storage pages                |     1 | Serializes manifest updates and bounds PNG buffers                |
| Annotation mirror pages      |     1 | Avoids concurrent Zotero database transactions                    |

MuPDF receives the attachment bytes once and retains the document in its
worker. Detection renders use a 640 px longest edge. An uncached result is
rendered directly from its PDF rectangle, with a target longest edge of 2,400
px, a maximum scale of 6x, and a maximum of 8,000,000 pixels. The renderer
never creates the previous 12 MP full-page preview canvas. A worst-case RGB
region pixmap is about 22.9 MiB before PNG encoding; only one region is active
at a time, although its encoded PNG may briefly coexist with the next crop.

Manual region correction reuses the same limits. Opening the correction dialog
renders one 640 px page preview through the existing MuPDF render permit.
Saving acquires the existing single high-resolution region and MuPDF render
permits, rerenders one PNG, and replaces the manifest only after the image
write. It does not add another Worker or increase pipeline depth.

The second inference worker intentionally duplicates the 19,505,323-byte Q8
model and its ONNX session. The two input tensors alone are about 9.4 MiB in
float32 form, excluding model intermediates. MuPDF adds its WASM linear memory,
one PDF byte copy, and a page display list whose size depends on page
complexity. This raises steady-state memory relative to one ONNX worker, but
removes the much larger full-page preview canvas and improves throughput. Do
not increase worker count, scheduled pages, the 8 MP region bound, or document
concurrency without a real-Zotero memory profile and focused tests.

## Required measurements

Performance logs distinguish wall time from concurrent stage totals. Record at
least MuPDF preparation/opening, page text extraction, detection rendering,
ONNX queueing, image decode, preprocessing, inference, postprocessing, direct
region rendering, PNG encoding, result-lock waiting, image writes, manifest
writes, annotation synchronization, and total wall time.

Validate changes in a real Zotero 10 installation with sparse 100-page PDFs,
dense 100-page PDFs, 20-page PDFs containing four figures per page, repeated
analysis, two readers, cancellation, and preview-renderer failure. The target is
no main-thread task above 50 ms where work can be chunked, no monotonic memory
growth over three repeated analyses, and no peak-memory regression above 15%
without a documented tradeoff.

## Model computation benchmark

The embedded Q8 model exposes only `output0`, the tensor consumed by the
plugin. It is reproducibly derived from the upstream Q8 model with
`onnx.utils.extract_model(source, target, ["images"], ["output0"])`. This
removes seven unused output branches without changing the remaining graph's
input, opset, quantization mode, or output values.

The benchmark command below renders representative corpus pages at the same
640 px detection size, preprocesses each page once, and reuses identical input
tensors across every candidate:

```bash
npm run benchmark:models -- \
  --model candidate=/path/to/candidate.onnx \
  --pdf-count 5 --pages-per-pdf 3 --warm-runs 1
```

With ONNX Runtime Web `1.22.0-dev.20250409-89f8206ba4`, WASM, and one thread,
the output-pruned model averaged 2,302.84 ms/page versus 2,390.47 ms/page for
the prior model across 15 pages from five PDFs, a 3.67% reduction. Every value
in all 15 `output0` tensors and every final NMS detection was exactly equal.
