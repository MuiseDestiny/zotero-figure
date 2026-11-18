import * as assert from "node:assert/strict";
import test from "node:test";
import { getDocumentPdfAttachments } from "../src/platform/zotero/figureResultRemoval";
import {
  acquireAttachmentOperation,
  isAttachmentBusy,
} from "../src/services/results/attachmentOperations";
import { FigureResultRemovalService } from "../src/services/results/figureResultRemovalService";
import { FigureResultStore } from "../src/services/results/figureResultStore";
import { OperationCancelledError } from "../src/utils/cancellation";
import { installMemoryIO } from "./helpers/memoryIO";

test("deletes one PNG and record, preserving other results, notes and source PDFs", async () => {
  const h = await harness();
  try {
    const before = await h.store.list(h.first);
    const changes: number[][] = [];
    const unsubscribe = h.service.subscribe(({ attachmentIDs }) =>
      changes.push(attachmentIDs),
    );
    await h.service.removeResult(h.owner, h.first, before[0].id);
    assert.deepEqual(
      (await h.store.list(h.first)).map(({ id }) => id),
      [before[1].id],
    );
    assert.equal(h.io.exists(before[0].imagePath), false);
    assert.equal(h.io.exists(before[1].imagePath), true);
    assert.equal((await h.store.list(h.second)).length, 1);
    assert.deepEqual(h.erased, []);
    assert.deepEqual(changes, [[h.first.id]]);
    assert.equal(h.io.readText("/source.pdf"), "source");
    assert.equal(h.io.readText("/note.png"), "saved note image");
    unsubscribe();
    await h.service.clearLocal(h.first);
    assert.deepEqual(changes, [[h.first.id]]);
  } finally {
    h.restore();
  }
});

test("cancel leaves manifests, PNGs and annotations untouched and releases reservations", async () => {
  const h = await harness();
  try {
    h.cancel = true;
    let notifications = 0;
    h.service.subscribe(() => notifications++);
    const before = await h.store.list(h.first);
    await h.service.clearDocument(h.owner, 1, 10);
    await h.service.removeResult(h.owner, h.first, before[0].id);
    assert.deepEqual(await h.store.list(h.first), before);
    assert.equal((await h.store.list(h.second)).length, 1);
    assert.equal(h.io.exists(before[0].imagePath), true);
    assert.equal(notifications, 0);
    assert.deepEqual(h.erased, []);
    assert.equal(isAttachmentBusy(h.first), false);
    assert.equal(isAttachmentBusy(h.second), false);
  } finally {
    h.restore();
  }
});

test("document clear covers all PDF attachments and hidden kinds, without crossing libraries", async () => {
  const h = await harness();
  try {
    const changes: number[][] = [];
    h.service.subscribe(({ attachmentIDs }) => changes.push(attachmentIDs));
    h.removeAnnotations = true;
    await h.service.clearDocument(h.owner, 1, 10);
    assert.deepEqual(await h.store.list(h.first), []);
    assert.deepEqual(await h.store.list(h.second), []);
    assert.equal(
      h.io.exists("/data/zotero-figure/results/1/FIRST/manifest.json"),
      false,
    );
    assert.equal(
      h.io.exists("/data/zotero-figure/results/1/SECOND/manifest.json"),
      false,
    );
    assert.deepEqual(h.erased, ["generated-first", "generated-second"]);
    assert.deepEqual(changes, [[h.first.id, h.second.id]]);
    assert.match(h.prompts[0], /"attachments":2,"count":3/);
    assert.deepEqual(await getDocumentPdfAttachments(2, 10), []);
    assert.equal(h.io.readText("/source.pdf"), "source");
    assert.equal(h.io.readText("/note.png"), "saved note image");
  } finally {
    h.restore();
  }
});

test("single-result annotation removal matches only the requested generated annotation", async () => {
  const h = await harness();
  try {
    h.removeAnnotations = true;
    const [result] = await h.store.list(h.first);
    await h.service.removeResult(h.owner, h.first, result.id);
    assert.deepEqual(h.erased, ["generated-first"]);
    assert.equal((await h.store.list(h.first)).length, 1);
  } finally {
    h.restore();
  }
});

test("active analysis blocks the entire document clear before any destructive action", async () => {
  const h = await harness();
  const release = await acquireAttachmentOperation(h.second);
  try {
    assert.equal(await h.service.isBusy(1, 10), true);
    await assert.rejects(
      h.service.clearDocument(h.owner, 1, 10),
      /gallery-delete-busy/,
    );
    assert.equal(h.prompts.length, 0);
    assert.equal((await h.store.list(h.first)).length, 2);
    assert.equal((await h.store.list(h.second)).length, 1);
    assert.equal(isAttachmentBusy(h.first), false);
  } finally {
    release();
    h.restore();
  }
});

test("reserves all document attachments until confirmation and deletion complete", async () => {
  const h = await harness();
  let acquired = false;
  let pending: Promise<() => void> | undefined;
  try {
    h.onConfirm = () => {
      assert.equal(isAttachmentBusy(h.first), true);
      assert.equal(isAttachmentBusy(h.second), true);
      pending = acquireAttachmentOperation(h.second).then((release) => {
        acquired = true;
        return release;
      });
      assert.equal(acquired, false);
    };
    await h.service.clearDocument(h.owner, 1, 10);
    const release = await pending!;
    assert.equal(acquired, true);
    release();
    assert.deepEqual(await h.store.list(h.second), []);
  } finally {
    h.restore();
  }
});

test("partial failure continues with other attachments, reports failure and refreshes once", async () => {
  const h = await harness();
  const remove = IOUtils.remove;
  try {
    const changes: number[][] = [];
    h.service.subscribe(({ attachmentIDs }) => changes.push(attachmentIDs));
    IOUtils.remove = async (path, options) => {
      if (String(path).endsWith("/FIRST")) throw new Error("disk denied");
      return remove(path, options);
    };
    await assert.rejects(
      h.service.clearDocument(h.owner, 1, 10),
      /gallery-delete-partial-error/,
    );
    assert.equal((await h.store.list(h.first)).length, 2);
    assert.deepEqual(await h.store.list(h.second), []);
    assert.deepEqual(changes, [[h.first.id, h.second.id]]);
    assert.equal(isAttachmentBusy(h.first), false);
    assert.equal(isAttachmentBusy(h.second), false);
  } finally {
    h.restore();
  }
});

test("mirror failure reports failure after local deletion and still notifies every view", async () => {
  const h = await harness();
  try {
    h.removeAnnotations = true;
    h.failAnnotations = true;
    let notifications = 0;
    h.service.subscribe(() => notifications++);
    const [result] = await h.store.list(h.first);
    await assert.rejects(
      h.service.removeResult(h.owner, h.first, result.id),
      /annotation denied/,
    );
    assert.equal((await h.store.list(h.first)).length, 1);
    assert.equal(notifications, 1);
    assert.equal(isAttachmentBusy(h.first), false);
  } finally {
    h.restore();
  }
});

test("plugin shutdown invalidates pending and new deletion work", async () => {
  const h = await harness();
  try {
    const pending = h.service.clearDocument(h.owner, 1, 10);
    h.service.dispose();
    await assert.rejects(pending, OperationCancelledError);
    await assert.rejects(
      h.service.clearLocal(h.first),
      OperationCancelledError,
    );
    assert.equal((await h.store.list(h.first)).length, 2);
    assert.equal(isAttachmentBusy(h.first), false);
  } finally {
    h.restore();
  }
});

async function harness() {
  const globals = globalThis as typeof globalThis & {
    Services: typeof Services;
    addon: typeof addon;
  };
  const previous = {
    Zotero: globalThis.Zotero,
    Services: globals.Services,
    addon: (globalThis as typeof globalThis & { addon: typeof addon }).addon,
  };
  const io = installMemoryIO();
  const erased: string[] = [];
  const prompts: string[] = [];
  const store = new FigureResultStore();
  const service = new FigureResultRemovalService(store);
  const document = {
    id: 10,
    libraryID: 1,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
    getAttachments: () => [11, 12, 13, 14],
    getDisplayTitle: () => "Paper",
  } as unknown as Zotero.Item;
  const first = attachment(11, "FIRST");
  const second = attachment(12, "SECOND");
  const items = new Map([
    [10, document],
    [11, first],
    [12, second],
    [13, { ...attachment(13, "OTHER_LIBRARY"), libraryID: 2 } as Zotero.Item],
    [
      14,
      {
        ...attachment(14, "NOTE"),
        isPDFAttachment: () => false,
      } as Zotero.Item,
    ],
  ]);
  const h = {
    store,
    service,
    io,
    first,
    second,
    prompts,
    erased,
    cancel: false,
    removeAnnotations: false,
    failAnnotations: false,
    owner: {} as Window,
    onConfirm: () => {},
    restore() {
      service.dispose();
      io.restore();
      globalThis.Zotero = previous.Zotero;
      globals.Services = previous.Services;
      (globalThis as typeof globalThis & { addon: typeof addon }).addon =
        previous.addon;
    },
  };
  function annotation(id: string, author: string, tag: string): Zotero.Item {
    return {
      annotationAuthorName: author,
      annotationType: "image",
      annotationPosition: JSON.stringify({
        pageIndex: 0,
        rects: [[1, 2, 10, 12]],
      }),
      annotationComment: "Caption",
      getTags: () => [{ tag }],
      eraseTx: async () => {
        if (h.failAnnotations) throw new Error("annotation denied");
        erased.push(id);
      },
    } as unknown as Zotero.Item;
  }
  function attachment(id: number, key: string): Zotero.Item {
    return {
      id,
      key,
      libraryID: 1,
      version: 1,
      topLevelItem: document,
      isPDFAttachment: () => true,
      getAnnotations: () => [
        annotation(
          id === 11 ? "generated-first" : "generated-second",
          "zoterofigure",
          "Figure 1",
        ),
        annotation("manual", "Researcher", "Figure 1"),
        annotation("unrelated", "zoterofigure", "Important"),
      ],
    } as unknown as Zotero.Item;
  }
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    logError() {},
    Items: {
      getAsync: async (ids: number | number[]) =>
        Array.isArray(ids) ? ids.map((id) => items.get(id)) : items.get(ids),
    },
  } as unknown as typeof Zotero;
  (globalThis as typeof globalThis & { addon: typeof addon }).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([message]: Array<{
            id: string;
            args?: unknown;
          }>) => [{ value: `${message.id} ${JSON.stringify(message.args)}` }],
        },
      },
    },
  } as unknown as typeof addon;
  globals.Services = {
    prompt: {
      BUTTON_POS_0: 1,
      BUTTON_POS_1: 256,
      BUTTON_TITLE_IS_STRING: 127,
      BUTTON_TITLE_CANCEL: 2,
      BUTTON_POS_1_DEFAULT: 16777216,
      confirmEx: (
        _owner: unknown,
        _title: string,
        text: string,
        _flags: number,
        _yes: string,
        _no: string,
        _other: string,
        _checkbox: string,
        checked: { value: boolean },
      ) => {
        prompts.push(text);
        h.onConfirm();
        checked.value = h.removeAnnotations;
        return h.cancel ? 1 : 0;
      },
    },
  } as unknown as typeof Services;
  for (const item of [first, second]) {
    const candidates = [
      {
        comment: "Caption",
        pageIndex: 0,
        rect: [1, 2, 10, 12] as [number, number, number, number],
        tag: "Figure 1",
      },
    ];
    if (item === first)
      candidates.push({
        ...candidates[0],
        rect: [21, 22, 30, 32],
        tag: "Table 1",
      });
    await store.reconcilePage(
      item,
      0,
      candidates,
      candidates.map(() => Uint8Array.of(1, 2, 3).buffer),
      "replace-page",
    );
  }
  io.writeText("/source.pdf", "source");
  io.writeText("/note.png", "saved note image");
  return h;
}
