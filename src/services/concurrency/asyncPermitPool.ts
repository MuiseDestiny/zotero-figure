import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";

interface PermitWaiter {
  abort?: () => void;
  reject(error: Error): void;
  resolve(release: () => void): void;
  signal?: AbortSignal;
}

/** A cancellation-aware concurrency gate with idempotent permit release. */
export class AsyncPermitPool {
  private activePermits = 0;
  private readonly waiters: PermitWaiter[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Permit pool maximum must be a positive integer");
    }
  }

  public get activeCount(): number {
    return this.activePermits;
  }

  public get pendingCount(): number {
    return this.waiters.length;
  }

  public acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    return new Promise<() => void>((resolve, reject) => {
      const waiter: PermitWaiter = { reject, resolve, signal };
      waiter.abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener("abort", waiter.abort as () => void);
        reject(new OperationCancelledError());
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.activePermits < this.maximum && this.waiters.length > 0) {
      const waiter = this.waiters.shift() as PermitWaiter;
      if (waiter.signal?.aborted) {
        waiter.abort?.();
        continue;
      }
      if (waiter.abort) {
        waiter.signal?.removeEventListener("abort", waiter.abort);
      }
      this.activePermits++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.activePermits--;
        this.dispatch();
      });
    }
  }
}
