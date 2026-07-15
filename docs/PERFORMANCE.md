# Analysis performance budget

Zotero Figure optimizes for a responsive Zotero window, not unbounded document
throughput. The analysis pipeline therefore uses one ONNX worker and explicit
limits for every stage.

## Pipeline limits

| Resource                      | Limit | Purpose                                                             |
| ----------------------------- | ----: | ------------------------------------------------------------------- |
| Scheduled pages               |     3 | Bounds all buffers retained by unfinished pages                     |
| Detection pages               |     2 | Allows one inference and one prepared page                          |
| PDF page renders              |     1 | Prevents detection and preview canvases from rendering concurrently |
| High-resolution preview pages |     1 | Bounds the largest RGBA canvas                                      |
| Storage pages                 |     1 | Serializes manifest updates and bounds PNG buffers                  |
| Annotation mirror pages       |     1 | Avoids concurrent Zotero database transactions                      |

The high-resolution page renderer uses at most 4x PDF scale, 12,000,000
pixels, and an 8,192 pixel longest dimension. A 12 MP RGBA canvas consumes
about 45.8 MiB. One page of encoded PNG crops may coexist with that canvas,
plus one 640 px JPEG and the worker's 640 x 640 tensors. This is why increasing
the scheduled-page count or adding a second inference worker requires a new
memory profile and focused concurrency tests.

## Required measurements

Performance logs distinguish wall time from concurrent stage totals. Record at
least page-data extraction, detection rendering, worker queueing, image decode,
preprocessing, inference, postprocessing, high-resolution PDF rendering, PNG
encoding, preview fallback, result-lock waiting, image writes, manifest writes,
annotation synchronization, and total wall time.

Validate changes in a real Zotero 9 installation with sparse 100-page PDFs,
dense 100-page PDFs, 20-page PDFs containing four figures per page, repeated
analysis, two readers, cancellation, and preview-renderer failure. The target is
no main-thread task above 50 ms where work can be chunked, no monotonic memory
growth over three repeated analyses, and no peak-memory regression above 15%
without a documented tradeoff.
