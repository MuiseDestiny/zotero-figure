import * as assert from "node:assert/strict";
import test from "node:test";
import { KeyedAsyncMutex } from "../src/services/concurrency/keyedAsyncMutex";
import { OperationCancelledError } from "../src/utils/cancellation";

test("serializes equal keys without blocking unrelated keys", async () => {
  const mutex = new KeyedAsyncMutex<string>();
  const releaseFirst = await mutex.acquire("first");
  const waiting = mutex.acquire("first");
  const releaseOther = await mutex.acquire("other");
  let acquired = false;
  void waiting.then(() => {
    acquired = true;
  });

  await Promise.resolve();
  assert.equal(acquired, false);
  releaseFirst();
  const releaseWaiting = await waiting;
  assert.equal(acquired, true);

  releaseWaiting();
  releaseOther();
});

test("removes a cancelled waiter and admits the next one", async () => {
  const mutex = new KeyedAsyncMutex<string>();
  const release = await mutex.acquire("attachment");
  const controller = new AbortController();
  const cancelled = mutex.acquire("attachment", controller.signal);
  const next = mutex.acquire("attachment");

  controller.abort();
  await assert.rejects(cancelled, OperationCancelledError);
  release();
  const releaseNext = await next;
  releaseNext();

  const releaseAfterCleanup = await mutex.acquire("attachment");
  releaseAfterCleanup();
});
