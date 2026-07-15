import { config } from "../../../package.json";
import type { Rect } from "../../domain/layout";
import { readAttachmentBytes } from "../../platform/zotero/attachmentFile";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import type {
  PdfAnalysisDocument,
  PdfAnalysisPageData,
  PdfDetectionImage,
  PdfEngine,
  PdfRegionImages,
} from "./pdfEngine";

type MuPdfRequestType =
  | "CLOSE_DOCUMENT"
  | "GET_PAGE_DATA"
  | "OPEN_DOCUMENT"
  | "RENDER_DETECTION"
  | "RENDER_REGIONS";

interface MuPdfWorkerResponse {
  documentID?: number;
  error?: string;
  pageCount?: number;
  requestID?: number;
  result?: unknown;
  type: "ERROR" | "READY" | "RESULT";
}

interface PendingRequest {
  abort?: () => void;
  reject(error: Error): void;
  resolve(value: MuPdfWorkerResponse): void;
  signal?: AbortSignal;
  timeoutID: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 2 * 60 * 1_000;
const INITIALIZATION_TIMEOUT_MS = 60_000;

export class MuPdfEngine implements PdfEngine {
  private readonly client: MuPdfWorkerClient;

  constructor(createWorker: () => Worker = createMuPdfWorker) {
    this.client = new MuPdfWorkerClient(createWorker);
  }

  public async prepare(signal?: AbortSignal): Promise<void> {
    await this.client.prepare(signal);
  }

  public async open(
    attachment: Zotero.Item,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisDocument> {
    throwIfAborted(signal);
    const bytes = await readAttachmentBytes(attachment, signal);
    return this.client.open(bytes, signal);
  }

  public dispose(): void {
    this.client.dispose();
  }
}

export class MuPdfWorkerClient {
  private disposed = false;
  private rejectInitialization?: (error: Error) => void;
  private nextDocumentID = 1;
  private nextRequestID = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readyPromise?: Promise<void>;
  private worker?: Worker;

  constructor(private readonly createWorker: () => Worker) {}

  public async prepare(signal?: AbortSignal): Promise<void> {
    this.assertActive();
    throwIfAborted(signal);
    await waitForPromise(this.ensureReady(), signal);
    this.assertActive();
  }

  public async open(
    bytes: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisDocument> {
    await this.prepare(signal);
    const documentID = this.nextDocumentID++;
    const response = await this.request(
      "OPEN_DOCUMENT",
      { documentID, pdfData: bytes },
      [bytes],
      signal,
    );
    const pageCount = response.pageCount;
    if (!Number.isInteger(pageCount) || (pageCount as number) < 1) {
      throw new Error("MuPDF returned an invalid page count");
    }
    return new MuPdfDocument(this, documentID, pageCount as number);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error("MuPDF worker was disposed");
    this.rejectInitialization?.(error);
    this.rejectInitialization = undefined;
    for (const request of this.pending.values()) {
      this.finishPendingRequest(request, error);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
  }

  public async getPageData(
    documentID: number,
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisPageData> {
    return (await this.request(
      "GET_PAGE_DATA",
      { documentID, pageIndex },
      undefined,
      signal,
    ).then(({ result }) => result)) as PdfAnalysisPageData;
  }

  public async renderDetectionImage(
    documentID: number,
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfDetectionImage> {
    return (await this.request(
      "RENDER_DETECTION",
      { documentID, pageIndex },
      undefined,
      signal,
    ).then(({ result }) => result)) as PdfDetectionImage;
  }

  public async renderRegions(
    documentID: number,
    pageIndex: number,
    rects: readonly Rect[],
    signal?: AbortSignal,
  ): Promise<PdfRegionImages> {
    return (await this.request(
      "RENDER_REGIONS",
      { documentID, pageIndex, rects },
      undefined,
      signal,
    ).then(({ result }) => result)) as PdfRegionImages;
  }

  public async closeDocument(documentID: number): Promise<void> {
    if (this.disposed) return;
    await this.request("CLOSE_DOCUMENT", { documentID }).catch((error) => {
      ztoolkit.log(`Unable to close MuPDF document ${documentID}`, error);
    });
  }

  private ensureReady(): Promise<void> {
    this.readyPromise ??= this.initialize();
    return this.readyPromise;
  }

  private initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const worker = this.createWorker();
      this.worker = worker;
      let settled = false;
      const timeoutID = setTimeout(() => {
        fail(new Error("MuPDF worker initialization timed out"));
      }, INITIALIZATION_TIMEOUT_MS);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutID);
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
        this.rejectInitialization = undefined;
        reject(toError(error));
      };
      this.rejectInitialization = (error) => fail(error);
      worker.onerror = (event) => fail(event.error ?? event.message);
      worker.onmessage = (event: MessageEvent<MuPdfWorkerResponse>) => {
        if (event.data.type === "ERROR" && event.data.requestID === undefined) {
          fail(event.data.error ?? "MuPDF worker initialization failed");
          return;
        }
        if (event.data.type !== "READY" || settled) return;
        settled = true;
        clearTimeout(timeoutID);
        this.rejectInitialization = undefined;
        worker.onerror = (event) =>
          this.handleWorkerFailure(event.error ?? event.message);
        worker.onmessage = (event) => this.handleWorkerMessage(event.data);
        resolve();
      };
    });
  }

  private request(
    type: MuPdfRequestType,
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
    signal?: AbortSignal,
  ): Promise<MuPdfWorkerResponse> {
    this.assertActive();
    throwIfAborted(signal);
    const worker = this.worker;
    if (!worker) throw new Error("MuPDF worker is not ready");
    const requestID = this.nextRequestID++;
    return new Promise<MuPdfWorkerResponse>((resolve, reject) => {
      const request: PendingRequest = {
        reject,
        resolve,
        signal,
        timeoutID: setTimeout(() => {
          this.pending.delete(requestID);
          this.finishPendingRequest(
            request,
            new Error(`MuPDF ${type} request timed out`),
          );
        }, REQUEST_TIMEOUT_MS),
      };
      request.abort = () => {
        this.pending.delete(requestID);
        this.finishPendingRequest(request, new OperationCancelledError());
      };
      signal?.addEventListener("abort", request.abort, { once: true });
      this.pending.set(requestID, request);
      try {
        worker.postMessage({ ...payload, requestID, type }, transfer);
      } catch (error) {
        this.pending.delete(requestID);
        this.finishPendingRequest(request, toError(error));
      }
    });
  }

  private handleWorkerMessage(response: MuPdfWorkerResponse): void {
    if (response.type === "READY" || response.requestID === undefined) return;
    const request = this.pending.get(response.requestID);
    if (!request) return;
    this.pending.delete(response.requestID);
    if (response.type === "ERROR") {
      this.finishPendingRequest(
        request,
        new Error(response.error ?? "MuPDF request failed"),
      );
    } else {
      this.finishPendingRequest(request, undefined, response);
    }
  }

  private handleWorkerFailure(error: unknown): void {
    const resolved = toError(error);
    for (const request of this.pending.values()) {
      this.finishPendingRequest(request, resolved);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.disposed = true;
  }

  private finishPendingRequest(
    request: PendingRequest,
    error?: Error,
    response?: MuPdfWorkerResponse,
  ): void {
    clearTimeout(request.timeoutID);
    if (request.abort) {
      request.signal?.removeEventListener("abort", request.abort);
    }
    if (error) request.reject(error);
    else request.resolve(response as MuPdfWorkerResponse);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("MuPDF worker was disposed");
  }
}

class MuPdfDocument implements PdfAnalysisDocument {
  private closed = false;

  constructor(
    private readonly client: MuPdfWorkerClient,
    private readonly documentID: number,
    public readonly pageCount: number,
  ) {}

  public getPageData(
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfAnalysisPageData> {
    this.assertOpen();
    this.assertPageIndex(pageIndex);
    return this.client.getPageData(this.documentID, pageIndex, signal);
  }

  public renderDetectionImage(
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<PdfDetectionImage> {
    this.assertOpen();
    this.assertPageIndex(pageIndex);
    return this.client.renderDetectionImage(this.documentID, pageIndex, signal);
  }

  public renderRegions(
    pageIndex: number,
    rects: readonly Rect[],
    signal?: AbortSignal,
  ): Promise<PdfRegionImages> {
    this.assertOpen();
    this.assertPageIndex(pageIndex);
    return this.client.renderRegions(this.documentID, pageIndex, rects, signal);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.closeDocument(this.documentID);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("MuPDF document is closed");
  }

  private assertPageIndex(pageIndex: number): void {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= this.pageCount
    ) {
      throw new RangeError(`Invalid PDF page index ${pageIndex}`);
    }
  }
}

function createMuPdfWorker(): Worker {
  return new Worker(
    `chrome://${config.addonRef}/content/mupdf-worker.js?v=${config.addonRef}`,
    { type: "module" },
  );
}

function waitForPromise<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new OperationCancelledError());
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
