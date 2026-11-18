import { KeyedAsyncMutex } from "../concurrency/keyedAsyncMutex";

// Shared by all analyzers and removal workflows, across main windows.
const operations = new KeyedAsyncMutex<string>();

function key(item: Zotero.Item): string {
  return `${item.libraryID}:${item.key}`;
}

export function isAttachmentBusy(item: Zotero.Item): boolean {
  return operations.isLocked(key(item));
}

export function acquireAttachmentOperation(
  item: Zotero.Item,
  signal?: AbortSignal,
): Promise<() => void> {
  return operations.acquire(key(item), signal);
}

export function tryAcquireAttachmentOperation(
  item: Zotero.Item,
): Promise<() => void> | undefined {
  return operations.tryAcquire(key(item));
}
