import * as assert from "node:assert/strict";
import test from "node:test";
import { openMonacoLatexEditor } from "../src/features/reader/monacoLatexEditor";

test("ignores the initial navigation unload and highlights the loaded LaTeX", async () => {
  const editor = new FakeMonacoEditor("original");
  const editorWindow = new FakeMonacoWindow();
  const ownerWindow = new FakeOwnerWindow(editorWindow);
  const session = openMonacoLatexEditor(ownerWindow as unknown as Window, {
    cancelLabel: "Cancel",
    initialValue: String.raw`\rho_{TOA}(\lambda)`,
    saveLabel: "Save",
    title: "Edit formula LaTeX",
  });
  let settled = false;
  void session.result.then(
    () => (settled = true),
    () => (settled = true),
  );

  editorWindow.dispatchEvent(new Event("unload"));
  await drainMicrotasks();
  assert.equal(settled, false);

  editorWindow.installLoader(editor);
  ownerWindow.runNextTimeout();
  await waitFor(() => editor.setValueCalls === 1);

  assert.equal(
    ownerWindow.openedURL,
    "chrome://scaffold/content/monaco/monaco.html",
  );
  assert.equal(editorWindow.document.title, "Edit formula LaTeX");
  assert.deepEqual(editorWindow.loadOptions, {
    language: "plaintext",
    theme: "vs-light",
  });
  assert.deepEqual(editorWindow.registeredLanguages, ["zoterofigure-latex"]);
  assert.equal(editorWindow.providerLanguage, "zoterofigure-latex");
  const rules = getTokenizerRules(editorWindow.providerDefinition);
  assert.ok(rules.length > 0);
  assert.ok(rules.every((rule) => typeof rule[0] === "string"));
  assert.equal(editorWindow.modelLanguage, "zoterofigure-latex");
  assert.equal(editor.value, String.raw`\rho_{TOA}(\lambda)`);
  assert.equal(editor.layoutCalls, 1);
  assert.deepEqual(editorWindow.document.buttonLabels(), ["Cancel", "Save"]);

  editor.value = String.raw`\rho_{edited}`;
  editorWindow.document.clickButton("Save");
  assert.equal(await session.result, String.raw`\rho_{edited}`);
  assert.equal(editorWindow.closed, true);
});

test("treats closing before Monaco is ready as cancellation", async () => {
  const editorWindow = new FakeMonacoWindow();
  const ownerWindow = new FakeOwnerWindow(editorWindow);
  const session = openMonacoLatexEditor(ownerWindow as unknown as Window, {
    cancelLabel: "Cancel",
    initialValue: "x",
    saveLabel: "Save",
    title: "Edit formula LaTeX",
  });

  session.close();
  assert.equal(await session.result, undefined);
  assert.equal(editorWindow.closed, true);

  ownerWindow.runNextTimeout();
  await drainMicrotasks();
});

test("treats closing or cancelling a loaded editor as cancellation", async () => {
  for (const action of ["close", "Cancel"] as const) {
    const editor = new FakeMonacoEditor("original");
    const editorWindow = new FakeMonacoWindow();
    editorWindow.installLoader(editor);
    const ownerWindow = new FakeOwnerWindow(editorWindow);
    const session = openMonacoLatexEditor(ownerWindow as unknown as Window, {
      cancelLabel: "Cancel",
      initialValue: "x",
      saveLabel: "Save",
      title: "Edit formula LaTeX",
    });
    await waitFor(() => editor.setValueCalls === 1);
    editor.value = "changed";

    if (action === "close") editorWindow.unload();
    else editorWindow.document.clickButton(action);

    assert.equal(await session.result, undefined);
  }
});

test("rejects a Monaco loader failure", async () => {
  const editorWindow = new FakeMonacoWindow();
  editorWindow.loadMonaco = async () => {
    throw new Error("loader failed");
  };
  const ownerWindow = new FakeOwnerWindow(editorWindow);
  const session = openMonacoLatexEditor(ownerWindow as unknown as Window, {
    cancelLabel: "Cancel",
    initialValue: "x",
    saveLabel: "Save",
    title: "Edit formula LaTeX",
  });

  await assert.rejects(session.result, /loader failed/);
  assert.equal(editorWindow.closed, true);
});

class FakeOwnerWindow {
  public openedURL?: string;
  private readonly timeouts: Array<() => void> = [];

  constructor(private readonly editorWindow: FakeMonacoWindow) {}

  public matchMedia(): { matches: boolean } {
    return { matches: false };
  }

  public openDialog(url: string): FakeMonacoWindow {
    this.openedURL = url;
    return this.editorWindow;
  }

  public runNextTimeout(): void {
    const callback = this.timeouts.shift();
    assert.ok(callback, "expected a pending Monaco readiness timeout");
    callback();
  }

  public setTimeout(callback: () => void): number {
    this.timeouts.push(callback);
    return this.timeouts.length;
  }
}

class FakeMonacoWindow extends EventTarget {
  public closed = false;
  public readonly document = new FakeDocument();
  public loadMonaco?: (
    options: Record<string, unknown>,
  ) => Promise<{ editor: FakeMonacoEditor; monaco: FakeMonacoAPI }>;
  public loadOptions?: Record<string, unknown>;
  public modelLanguage?: string;
  public providerDefinition?: Record<string, unknown>;
  public providerLanguage?: string;
  public readonly registeredLanguages: string[] = [];

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event("unload"));
  }

  public focus(): void {}

  public installLoader(editor: FakeMonacoEditor): void {
    this.loadMonaco = async (options) => {
      this.loadOptions = options;
      return { editor, monaco: this.createMonacoAPI() };
    };
  }

  public unload(): void {
    this.closed = true;
    this.dispatchEvent(new Event("unload"));
  }

  private createMonacoAPI(): FakeMonacoAPI {
    return {
      editor: {
        setModelLanguage: (_model, languageID) => {
          this.modelLanguage = languageID;
        },
      },
      languages: {
        register: ({ id }) => this.registeredLanguages.push(id),
        setMonarchTokensProvider: (languageID, definition) => {
          this.providerLanguage = languageID;
          this.providerDefinition = definition;
        },
      },
    };
  }
}

class FakeMonacoEditor {
  public layoutCalls = 0;
  public setValueCalls = 0;
  public value: string;
  private readonly model = {};

  constructor(value: string) {
    this.value = value;
  }

  public focus(): void {}

  public getModel(): object {
    return this.model;
  }

  public getValue(): string {
    return this.value;
  }

  public layout(): void {
    this.layoutCalls++;
  }

  public setValue(value: string): void {
    this.setValueCalls++;
    this.value = value;
  }
}

class FakeDocument {
  public readonly body = new FakeElement();
  public readonly container = new FakeElement();
  public title = "";

  public buttonLabels(): string[] {
    return this.body
      .descendants()
      .filter((element) => element.type === "button")
      .map((element) => element.textContent);
  }

  public clickButton(label: string): void {
    const button = this.body
      .descendants()
      .find(
        (element) => element.type === "button" && element.textContent === label,
      );
    assert.ok(button, `missing Monaco action button: ${label}`);
    button.dispatchEvent(new Event("click"));
  }

  public createElement(): FakeElement {
    return new FakeElement();
  }

  public getElementById(id: string): FakeElement | null {
    return id === "container" ? this.container : null;
  }
}

class FakeElement extends EventTarget {
  public readonly children: FakeElement[] = [];
  public readonly style: Record<string, string> = {};
  public textContent = "";
  public type = "";

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

interface FakeMonacoAPI {
  editor: {
    setModelLanguage(model: object, languageID: string): void;
  };
  languages: {
    register(language: { id: string }): void;
    setMonarchTokensProvider(
      languageID: string,
      definition: Record<string, unknown>,
    ): void;
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail("condition was not met");
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function getTokenizerRules(
  definition: Record<string, unknown> | undefined,
): unknown[][] {
  assert.ok(definition);
  const tokenizer = definition.tokenizer as { root?: unknown } | undefined;
  assert.ok(Array.isArray(tokenizer?.root));
  return tokenizer.root as unknown[][];
}
