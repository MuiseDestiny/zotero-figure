const MONACO_EDITOR_URL = "chrome://scaffold/content/monaco/monaco.html";
const MONACO_LOAD_ATTEMPTS = 100;
const MONACO_LOAD_INTERVAL_MS = 50;
const MONACO_LOG_PREFIX = "[Zotero Figure][LaTeX editor]";
const LATEX_LANGUAGE_ID = "zoterofigure-latex";

type MonacoModel = object;

interface MonacoEditor {
  focus(): void;
  getModel(): MonacoModel | null;
  getValue(): string;
  layout(): void;
  setValue(value: string): void;
}

interface MonacoAPI {
  editor: {
    setModelLanguage(model: MonacoModel, languageID: string): void;
  };
  languages: {
    register(language: { id: string }): void;
    setMonarchTokensProvider(
      languageID: string,
      definition: Record<string, unknown>,
    ): void;
  };
}

interface MonacoWindow extends Window {
  loadMonaco?: (options: Record<string, unknown>) => Promise<{
    editor: MonacoEditor;
    monaco: MonacoAPI;
  }>;
}

export interface MonacoLatexEditorOptions {
  cancelLabel: string;
  initialValue: string;
  saveLabel: string;
  title: string;
}

export interface MonacoLatexEditorSession {
  close(): void;
  result: Promise<string | undefined>;
}

/** Mirrors the Monaco workflow used by Zotero-GPT's system-prompt editor. */
export function openMonacoLatexEditor(
  ownerWindow: Window,
  options: MonacoLatexEditorOptions,
): MonacoLatexEditorSession {
  logMonacoStage(
    "openDialog requested",
    `openDialog=${typeof ownerWindow.openDialog}, initialLength=${options.initialValue.length}`,
  );
  let editorWindow: MonacoWindow | null;
  try {
    editorWindow = ownerWindow.openDialog(
      MONACO_EDITOR_URL,
      "monaco",
      "chrome,centerscreen,dialog=no,resizable,scrollbars=yes,width=800,height=600",
    ) as MonacoWindow | null;
  } catch (error) {
    const normalized = toError(error);
    logMonacoStage("openDialog threw", normalized.message);
    return rejectedSession(normalized);
  }
  if (!editorWindow) {
    logMonacoStage("openDialog returned no window");
    return rejectedSession(
      new Error("Zotero did not open the Monaco editor window"),
    );
  }
  const activeEditorWindow = editorWindow;
  logMonacoStage("openDialog returned a window");

  let editor: MonacoEditor | undefined;
  let settled = false;
  let resolveResult!: (value: string | undefined) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<string | undefined>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settle = (value: string | undefined): void => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  const reject = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectResult(error);
  };
  const closeWindow = (): void => {
    if (!activeEditorWindow.closed) activeEditorWindow.close();
  };
  const cancel = (): void => {
    settle(undefined);
    closeWindow();
  };
  const save = (loadedEditor: MonacoEditor): void => {
    try {
      settle(loadedEditor.getValue());
    } catch (error) {
      reject(toError(error));
    }
    closeWindow();
  };
  const handleUnload = (): void => {
    logMonacoStage(
      "window unloaded",
      `editor=${editor ? "ready" : "missing"}, saved=${settled}`,
    );
    settle(undefined);
  };
  activeEditorWindow.focus();
  logMonacoStage("initialization started");

  void initializeMonacoEditor(
    ownerWindow,
    activeEditorWindow,
    options,
    () => {
      // openDialog returns a WindowProxy before its initial document navigates
      // to monaco.html. Observe unload only after that navigation has completed.
      activeEditorWindow.addEventListener("unload", handleUnload, {
        once: true,
      });
    },
    cancel,
    save,
  )
    .then((loadedEditor) => {
      if (!loadedEditor) {
        settle(undefined);
        return;
      }
      editor = loadedEditor;
      logMonacoStage("initialization completed");
    })
    .catch((error) => {
      const normalized = toError(error);
      logMonacoStage("initialization failed", normalized.message);
      reject(normalized);
      closeWindow();
    });

  return {
    close: () => {
      logMonacoStage("session close requested", `settled=${settled}`);
      cancel();
    },
    result,
  };
}

async function initializeMonacoEditor(
  ownerWindow: Window,
  editorWindow: MonacoWindow,
  options: MonacoLatexEditorOptions,
  observeUnload: () => void,
  onCancel: () => void,
  onSave: (editor: MonacoEditor) => void,
): Promise<MonacoEditor | undefined> {
  const ready = await waitForMonaco(ownerWindow, editorWindow);
  if (!ready) return undefined;
  if (editorWindow.closed || !editorWindow.loadMonaco) {
    return undefined;
  }
  observeUnload();
  const isDark = ownerWindow.matchMedia?.(
    "(prefers-color-scheme: dark)",
  )?.matches;
  logMonacoStage("loadMonaco called", `theme=${isDark ? "dark" : "light"}`);
  const { editor, monaco } = await editorWindow.loadMonaco({
    language: "plaintext",
    theme: `vs-${isDark ? "dark" : "light"}`,
  });
  if (editorWindow.closed) return undefined;
  installLatexLanguage(monaco, editor);
  editorWindow.document.title = options.title;
  editor.setValue(options.initialValue);
  installMonacoActions(editorWindow, editor, options, onCancel, onSave);
  editor.focus();
  editorWindow.focus();
  logMonacoStage(
    "editor value installed",
    `length=${options.initialValue.length}`,
  );
  return editor;
}

function installMonacoActions(
  editorWindow: MonacoWindow,
  editor: MonacoEditor,
  options: MonacoLatexEditorOptions,
  onCancel: () => void,
  onSave: (editor: MonacoEditor) => void,
): void {
  const { body } = editorWindow.document;
  const container = editorWindow.document.getElementById("container");
  if (!body || !container)
    throw new Error("Monaco editor layout is unavailable");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  container.style.flex = "1 1 auto";
  container.style.height = "auto";
  container.style.minHeight = "0";

  const actions = editorWindow.document.createElement("div");
  actions.style.alignItems = "center";
  actions.style.background = "var(--material-background, Canvas)";
  actions.style.borderTop = "1px solid var(--fill-quaternary, #c7c7c7)";
  actions.style.display = "flex";
  actions.style.flex = "0 0 auto";
  actions.style.gap = "8px";
  actions.style.justifyContent = "flex-end";
  actions.style.padding = "10px 12px";

  const cancelButton = editorWindow.document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = options.cancelLabel;
  cancelButton.addEventListener("click", onCancel);
  const saveButton = editorWindow.document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = options.saveLabel;
  saveButton.addEventListener("click", () => onSave(editor));
  actions.append(cancelButton, saveButton);
  body.append(actions);
  editor.layout();
}

async function waitForMonaco(
  ownerWindow: Window,
  editorWindow: MonacoWindow,
): Promise<boolean> {
  for (let attempt = 0; attempt < MONACO_LOAD_ATTEMPTS; attempt++) {
    if (typeof editorWindow.loadMonaco === "function") {
      logMonacoStage("Monaco loader ready", `attempt=${attempt + 1}`);
      return true;
    }
    if (editorWindow.closed) {
      logMonacoStage("window closed while waiting for Monaco loader");
      return false;
    }
    await new Promise<void>((resolve) =>
      ownerWindow.setTimeout(resolve, MONACO_LOAD_INTERVAL_MS),
    );
  }
  logMonacoStage("Monaco loader timed out");
  throw new Error("Monaco editor did not load");
}

function installLatexLanguage(monaco: MonacoAPI, editor: MonacoEditor): void {
  monaco.languages.register({ id: LATEX_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, {
    defaultToken: "",
    tokenPostfix: ".latex",
    tokenizer: {
      root: [
        ["%.*$", "comment"],
        ["\\\\(?:begin|end)(?=\\s*\\{)", "keyword.control"],
        ["\\\\[A-Za-z@]+", "keyword"],
        ["\\\\.", "keyword"],
        ["[{}]", "delimiter.curly"],
        ["(?:\\[|\\])", "delimiter.square"],
        ["[()]", "delimiter.parenthesis"],
        ["[&_^~#]", "operator"],
        ["\\d+(?:\\.\\d+)?", "number"],
      ],
    },
  });
  const model = editor.getModel();
  if (model) monaco.editor.setModelLanguage(model, LATEX_LANGUAGE_ID);
}

function rejectedSession(error: Error): MonacoLatexEditorSession {
  return {
    close: () => {},
    result: Promise.reject(error),
  };
}

function logMonacoStage(stage: string, details?: string): void {
  if (typeof ztoolkit === "undefined") return;
  ztoolkit.log(`${MONACO_LOG_PREFIX} ${stage}${details ? `: ${details}` : ""}`);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
