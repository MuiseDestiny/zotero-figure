import * as assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisTelemetry,
  createAnalysisTimingLog,
  PageAnalysisTelemetry,
} from "../src/services/layout/analysisTelemetry";

test("accumulates page counters, summed timings, and preview peaks", () => {
  const telemetry = new AnalysisTelemetry(4, 100, () => 250);
  telemetry.recordSkippedPage();

  const first = new PageAnalysisTelemetry(() => 100);
  first.timings.annotationMs = 3;
  first.timings.detectionMs = 8;
  first.timings.previewMaxScale = 2;
  first.timings.previewPeakPixels = 400;
  telemetry.mergePage(
    first.succeed(
      { created: 2, removed: 1, skipped: 3 },
      { created: 1, removed: 0, skipped: 2 },
    ),
  );

  const second = new PageAnalysisTelemetry(() => 100);
  second.timings.annotationMs = 5;
  second.timings.detectionMs = 7;
  second.timings.previewMaxScale = 1.5;
  second.timings.previewPeakPixels = 900;
  telemetry.mergePage(
    second.succeed(
      { created: 0, removed: 4, skipped: 1 },
      { created: 0, removed: 3, skipped: 1 },
    ),
  );

  telemetry.mergeFinalization({
    annotationsRemoved: 2,
    resultsRemoved: 3,
    timings: {
      annotationMs: 4,
      annotationStageWaitMs: 1,
      imageWriteMs: 2,
      lockWaitMs: 3,
      manifestWriteMs: 4,
      storageMs: 5,
      storageStageWaitMs: 6,
    },
  });
  telemetry.finish();

  assert.deepEqual(
    {
      annotationsCreated: telemetry.summary.annotationsCreated,
      annotationsRemoved: telemetry.summary.annotationsRemoved,
      annotationsSkipped: telemetry.summary.annotationsSkipped,
      pagesAnalyzed: telemetry.summary.pagesAnalyzed,
      pagesSkipped: telemetry.summary.pagesSkipped,
      resultsCreated: telemetry.summary.resultsCreated,
      resultsRemoved: telemetry.summary.resultsRemoved,
      resultsSkipped: telemetry.summary.resultsSkipped,
    },
    {
      annotationsCreated: 1,
      annotationsRemoved: 5,
      annotationsSkipped: 3,
      pagesAnalyzed: 2,
      pagesSkipped: 1,
      resultsCreated: 2,
      resultsRemoved: 8,
      resultsSkipped: 4,
    },
  );
  assert.equal(telemetry.summary.timings.annotationMs, 12);
  assert.equal(telemetry.summary.timings.detectionMs, 15);
  assert.equal(telemetry.summary.timings.previewMaxScale, 2);
  assert.equal(telemetry.summary.timings.previewPeakPixels, 900);
  assert.equal(telemetry.summary.timings.totalMs, 150);
});

test("failed page telemetry keeps partial timings and supplies detection wall time", () => {
  let now = 10;
  const page = new PageAnalysisTelemetry(() => now);
  page.timings.renderingMs = 4;
  now = 35;

  const outcome = page.fail();

  assert.equal(outcome.failed, true);
  assert.deepEqual(outcome.results, { created: 0, removed: 0, skipped: 0 });
  assert.equal(outcome.timings.detectionMs, 25);
  assert.equal(outcome.timings.renderingMs, 4);
});

test("failed pages retain timings without inventing result counts", () => {
  let now = 20;
  const telemetry = new AnalysisTelemetry(1, now, () => now);
  const page = new PageAnalysisTelemetry(() => now);
  page.timings.detectionStageWaitMs = 3;
  page.timings.previewMaxScale = 2;
  page.timings.previewPeakPixels = 640;
  now = 45;

  telemetry.mergePage(page.fail());

  assert.equal(telemetry.summary.failedPages, 1);
  assert.equal(telemetry.summary.pagesAnalyzed, 0);
  assert.equal(telemetry.summary.resultsCreated, 0);
  assert.equal(telemetry.summary.resultsRemoved, 0);
  assert.equal(telemetry.summary.resultsSkipped, 0);
  assert.equal(telemetry.summary.annotationsCreated, 0);
  assert.equal(telemetry.summary.annotationsRemoved, 0);
  assert.equal(telemetry.summary.annotationsSkipped, 0);
  assert.equal(telemetry.summary.timings.detectionMs, 25);
  assert.equal(telemetry.summary.timings.detectionStageWaitMs, 3);
  assert.equal(telemetry.summary.timings.previewMaxScale, 2);
  assert.equal(telemetry.summary.timings.previewPeakPixels, 640);
});

test("responsiveness monitoring schedules and clears one interval", (context) => {
  const intervalHandle = 37 as unknown as ReturnType<typeof setInterval>;
  let clock = 100;
  let intervalsStarted = 0;
  let intervalsCleared = 0;
  let sample: (() => void) | undefined;
  context.mock.method(Date, "now", () => clock);
  context.mock.method(globalThis, "setInterval", ((callback: () => void) => {
    intervalsStarted++;
    sample = callback;
    return intervalHandle;
  }) as unknown as typeof setInterval);
  context.mock.method(globalThis, "clearInterval", ((
    handle: ReturnType<typeof setInterval>,
  ) => {
    assert.equal(handle, intervalHandle);
    intervalsCleared++;
  }) as typeof clearInterval);
  const telemetry = new AnalysisTelemetry(0, 0, () => 10);

  telemetry.startResponsivenessMonitoring();
  telemetry.startResponsivenessMonitoring();
  clock = 170;
  sample?.();
  clock = 280;
  sample?.();
  telemetry.finish();
  telemetry.finish();

  assert.equal(intervalsStarted, 1);
  assert.equal(intervalsCleared, 1);
  assert.equal(telemetry.summary.timings.eventLoopLagMaxMs, 60);
  assert.equal(telemetry.summary.timings.eventLoopLongTaskCount, 1);
});

test("formats a stable analysis timing log without Zotero globals", () => {
  const telemetry = new AnalysisTelemetry(2, 0, () => 12.34);
  telemetry.summary.timings.modelPreparationMs = 1.26;
  telemetry.summary.timings.previewMaxScale = 2.04;
  telemetry.finish();

  const log = createAnalysisTimingLog(
    { itemID: 7, key: "ATTACHMENT", libraryID: 1 },
    telemetry.summary,
    false,
  );

  assert.deepEqual(log.attachment, {
    itemID: 7,
    key: "ATTACHMENT",
    libraryID: 1,
  });
  assert.equal(log.wallMs, 12.3);
  assert.equal(log.setupMs.model, 1.3);
  assert.equal(log.preview.maxScale, 2);
  assert.equal(log.annotations.enabled, false);
});
