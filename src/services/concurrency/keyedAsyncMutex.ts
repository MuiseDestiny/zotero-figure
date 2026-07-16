import { AsyncPermitPool } from "./asyncPermitPool";

interface MutexEntry {
  readonly permits: AsyncPermitPool;
  references: number;
}

/** Serializes work by key while allowing unrelated keys to proceed concurrently. */
export class KeyedAsyncMutex<Key> {
  private readonly entries = new Map<Key, MutexEntry>();

  public async acquire(key: Key, signal?: AbortSignal): Promise<() => void> {
    const entry = this.entries.get(key) ?? {
      permits: new AsyncPermitPool(1),
      references: 0,
    };
    this.entries.set(key, entry);
    entry.references++;

    let releasePermit: (() => void) | undefined;
    try {
      releasePermit = await entry.permits.acquire(signal);
    } catch (error) {
      this.releaseReference(key, entry);
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releasePermit?.();
      this.releaseReference(key, entry);
    };
  }

  private releaseReference(key: Key, entry: MutexEntry): void {
    entry.references--;
    if (entry.references === 0 && this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
  }
}
