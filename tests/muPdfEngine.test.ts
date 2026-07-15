import * as assert from "node:assert/strict";
import test from "node:test";
import { MuPdfWorkerClient } from "../src/services/pdf/muPdfEngine";
import { OperationCancelledError } from "../src/utils/cancellation";

class FakeMuPdfWorker {
  public onerror: ((event: ErrorEvent) => unknown) | null = null;
  public onmessage: ((event: MessageEvent) => unknown) | null = null;
  public readonly messages: Array<Record<string, unknown>> = [];
  public readonly transfers: Array<readonly Transferable[] | undefined> = [];
  public terminated = false;

  public constructor() {
    queueMicrotask(() => this.respond({ type: "READY" }));
  }

  public postMessage(
    message: Record<string, unknown>,
    transfer?: readonly Transferable[],
  ): void {
    this.messages.push(message);
    this.transfers.push(transfer);
    if (message.type === "OPEN_DOCUMENT") {
      queueMicrotask(() =>
        this.respond({
          pageCount: 2,
          requestID: message.requestID,
          type: "RESULT",
        }),
      );
    }
    if (message.type === "CLOSE_DOCUMENT") {
      queueMicrotask(() =>
        this.respond({ requestID: message.requestID, type: "RESULT" }),
      );
    }
  }

  public respond(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  public terminate(): void {
    this.terminated = true;
  }
}

test("transfers PDF bytes once and reuses the worker document handle", async () => {
  const worker = new FakeMuPdfWorker();
  const client = new MuPdfWorkerClient(() => worker as unknown as Worker);
  const bytes = new ArrayBuffer(16);
  const document = await client.open(bytes);

  assert.equal(document.pageCount, 2);
  assert.equal(worker.messages[0].type, "OPEN_DOCUMENT");
  assert.deepEqual(worker.transfers[0], [bytes]);

  await document.close();
  assert.equal(worker.messages[1].type, "CLOSE_DOCUMENT");
  client.dispose();
  assert.equal(worker.terminated, true);
});

test("reports cancellation without waiting for a synchronous MuPDF task", async () => {
  const worker = new FakeMuPdfWorker();
  const client = new MuPdfWorkerClient(() => worker as unknown as Worker);
  const document = await client.open(new ArrayBuffer(16));
  const controller = new AbortController();
  const rendering = document.renderDetectionImage(0, controller.signal);
  controller.abort();

  await assert.rejects(rendering, OperationCancelledError);
  client.dispose();
});
