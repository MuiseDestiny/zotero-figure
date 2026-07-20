const LATEX_EDITOR_URL =
  "chrome://zoterofigure/content/latex-editor/index.html";
const LATEX_EDITOR_WINDOW_NAME = "zoterofigure-latex-editor";
const LATEX_EDITOR_LOG_PREFIX = "[Zotero Figure][LaTeX editor]";

export interface CodeMirrorLatexEditorOptions {
  cancelLabel: string;
  initialValue: string;
  invalidLabel: string;
  previewLabel: string;
  saveLabel: string;
  sourceLabel: string;
  title: string;
}

export interface CodeMirrorLatexEditorDialogData extends CodeMirrorLatexEditorOptions {
  cancel(): void;
  fail(message: string): void;
  save(value: string): void;
}

export interface CodeMirrorLatexEditorSession {
  close(): void;
  result: Promise<string | undefined>;
}

export function openCodeMirrorLatexEditor(
  ownerWindow: Window,
  options: CodeMirrorLatexEditorOptions,
): CodeMirrorLatexEditorSession {
  let settled = false;
  let editorWindow: Window | null = null;
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
  const reject = (message: string): void => {
    if (settled) return;
    settled = true;
    rejectResult(new Error(message));
  };
  const dialogData: CodeMirrorLatexEditorDialogData = {
    ...options,
    cancel: () => settle(undefined),
    fail: reject,
    save: settle,
  };

  try {
    editorWindow = ownerWindow.openDialog(
      LATEX_EDITOR_URL,
      LATEX_EDITOR_WINDOW_NAME,
      "chrome,centerscreen,dialog=no,resizable,width=800,height=600",
      dialogData,
    );
  } catch (error) {
    reject(toError(error).message);
  }
  if (!editorWindow) {
    if (!settled) reject("Zotero did not open the LaTeX editor window");
    return {
      close: () => {},
      result,
    };
  }

  const activeEditorWindow = editorWindow;
  const handleUnload = (): void => {
    logLatexEditor("window unloaded", `settled=${settled}`);
    settle(undefined);
  };
  activeEditorWindow.addEventListener(
    "load",
    () => {
      activeEditorWindow.addEventListener("unload", handleUnload, {
        once: true,
      });
    },
    { once: true },
  );
  activeEditorWindow.focus();
  logLatexEditor(
    "window opened",
    `initialLength=${options.initialValue.length}`,
  );

  return {
    close: () => {
      settle(undefined);
      if (!activeEditorWindow.closed) activeEditorWindow.close();
    },
    result,
  };
}

function logLatexEditor(stage: string, details?: string): void {
  if (typeof ztoolkit === "undefined") return;
  ztoolkit.log(
    `${LATEX_EDITOR_LOG_PREFIX} ${stage}${details ? `: ${details}` : ""}`,
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
