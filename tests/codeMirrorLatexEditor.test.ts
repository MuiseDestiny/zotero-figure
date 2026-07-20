import * as assert from "node:assert/strict";
import test from "node:test";
import {
  openCodeMirrorLatexEditor,
  type CodeMirrorLatexEditorDialogData,
} from "../src/features/reader/codeMirrorLatexEditor";

const options = {
  cancelLabel: "Cancel",
  initialValue: String.raw`\rho_{TOA}(\lambda)`,
  invalidLabel: "Could not render this LaTeX",
  previewLabel: "Preview",
  saveLabel: "Save",
  sourceLabel: "LaTeX source",
  title: "Edit formula LaTeX",
};

test("opens the addon-owned CodeMirror window and returns its saved source", async () => {
  const editorWindow = new FakeEditorWindow();
  const ownerWindow = new FakeOwnerWindow(editorWindow);
  const session = openCodeMirrorLatexEditor(
    ownerWindow as unknown as Window,
    options,
  );
  let settled = false;
  void session.result.finally(() => (settled = true));

  editorWindow.dispatchEvent(new Event("unload"));
  await drainMicrotasks();
  assert.equal(settled, false);
  editorWindow.dispatchEvent(new Event("load"));

  assert.equal(
    ownerWindow.openedURL,
    "chrome://zoterofigure/content/latex-editor/index.html",
  );
  assert.equal(ownerWindow.openedName, "zoterofigure-latex-editor");
  assert.equal(
    ownerWindow.openedFeatures,
    "chrome,centerscreen,dialog=no,resizable,width=800,height=600",
  );
  assert.deepEqual(
    {
      cancelLabel: ownerWindow.dialogData?.cancelLabel,
      initialValue: ownerWindow.dialogData?.initialValue,
      invalidLabel: ownerWindow.dialogData?.invalidLabel,
      previewLabel: ownerWindow.dialogData?.previewLabel,
      saveLabel: ownerWindow.dialogData?.saveLabel,
      sourceLabel: ownerWindow.dialogData?.sourceLabel,
      title: ownerWindow.dialogData?.title,
    },
    options,
  );
  assert.equal(editorWindow.focusCalls, 1);

  ownerWindow.dialogData?.save(String.raw`\rho_{edited}`);
  assert.equal(await session.result, String.raw`\rho_{edited}`);
});

test("treats dialog cancellation, closing, and owner cleanup as cancellation", async () => {
  for (const action of ["cancel", "unload", "close"] as const) {
    const editorWindow = new FakeEditorWindow();
    const ownerWindow = new FakeOwnerWindow(editorWindow);
    const session = openCodeMirrorLatexEditor(
      ownerWindow as unknown as Window,
      options,
    );
    editorWindow.dispatchEvent(new Event("load"));

    if (action === "cancel") ownerWindow.dialogData?.cancel();
    else if (action === "unload") editorWindow.unload();
    else session.close();

    assert.equal(await session.result, undefined);
    if (action === "close") assert.equal(editorWindow.closed, true);
  }
});

test("rejects an initialization failure reported by the editor window", async () => {
  const editorWindow = new FakeEditorWindow();
  const ownerWindow = new FakeOwnerWindow(editorWindow);
  const session = openCodeMirrorLatexEditor(
    ownerWindow as unknown as Window,
    options,
  );

  ownerWindow.dialogData?.fail("editor failed");
  await assert.rejects(session.result, /editor failed/);
});

class FakeOwnerWindow {
  public dialogData?: CodeMirrorLatexEditorDialogData;
  public openedFeatures?: string;
  public openedName?: string;
  public openedURL?: string;

  constructor(private readonly editorWindow: FakeEditorWindow) {}

  public openDialog(
    url: string,
    name: string,
    features: string,
    dialogData: CodeMirrorLatexEditorDialogData,
  ): FakeEditorWindow {
    this.openedURL = url;
    this.openedName = name;
    this.openedFeatures = features;
    this.dialogData = dialogData;
    return this.editorWindow;
  }
}

class FakeEditorWindow extends EventTarget {
  public closed = false;
  public focusCalls = 0;

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event("unload"));
  }

  public focus(): void {
    this.focusCalls++;
  }

  public unload(): void {
    this.closed = true;
    this.dispatchEvent(new Event("unload"));
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
