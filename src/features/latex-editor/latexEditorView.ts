import { StreamLanguage } from "@codemirror/language";
import { stexMath } from "@codemirror/legacy-modes/mode/stex";
import { basicSetup, EditorView } from "codemirror";
import type { CodeMirrorLatexEditorDialogData } from "../reader/codeMirrorLatexEditor";
import { renderLatexToString } from "../../utils/renderLatex";

const PREVIEW_DELAY_MS = 80;

export type LatexPreviewState =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; markup: string };

interface LatexEditorWindow extends Window {
  arguments?: [CodeMirrorLatexEditorDialogData];
}

export function getLatexPreviewState(latex: string): LatexPreviewState {
  const normalized = latex.trim();
  if (!normalized) return { kind: "empty" };
  try {
    return {
      kind: "valid",
      markup: renderLatexToString(normalized, { throwOnError: true }),
    };
  } catch (error) {
    return { kind: "invalid", message: toError(error).message };
  }
}

export function initializeLatexEditor(
  editorWindow: LatexEditorWindow,
): () => void {
  const dialogData = editorWindow.arguments?.[0];
  if (!dialogData) throw new Error("LaTeX editor data is unavailable");
  const document = editorWindow.document;
  const editorHost = requireElement(document, "latex-editor");
  const preview = requireElement(document, "latex-preview");
  const previewError = requireElement(document, "latex-preview-error");
  const sourceLabel = requireElement(document, "latex-source-label");
  const previewLabel = requireElement(document, "latex-preview-label");
  const cancelButton = requireButton(document, "latex-cancel");
  const saveButton = requireButton(document, "latex-save");
  let previewTimer: number | undefined;

  document.title = dialogData.title;
  sourceLabel.textContent = dialogData.sourceLabel;
  previewLabel.textContent = dialogData.previewLabel;
  cancelButton.textContent = dialogData.cancelLabel;
  saveButton.textContent = dialogData.saveLabel;

  const updatePreview = (latex: string): LatexPreviewState => {
    const state = getLatexPreviewState(latex);
    preview.hidden = state.kind !== "valid";
    previewError.hidden = state.kind !== "invalid";
    preview.replaceChildren();
    if (state.kind === "valid") {
      const range = document.createRange();
      range.selectNodeContents(preview);
      preview.replaceChildren(range.createContextualFragment(state.markup));
      range.detach();
    } else if (state.kind === "invalid") {
      previewError.textContent = `${dialogData.invalidLabel}: ${state.message}`;
    } else {
      previewError.textContent = "";
    }
    saveButton.disabled = state.kind !== "valid";
    return state;
  };
  const schedulePreview = (latex: string): void => {
    if (previewTimer !== undefined) editorWindow.clearTimeout(previewTimer);
    previewTimer = editorWindow.setTimeout(() => {
      previewTimer = undefined;
      updatePreview(latex);
    }, PREVIEW_DELAY_MS);
  };
  const close = (): void => editorWindow.close();
  const cancel = (): void => {
    dialogData.cancel();
    close();
  };
  const save = (): void => {
    const value = editor.state.doc.toString();
    if (updatePreview(value).kind !== "valid") return;
    dialogData.save(value);
    close();
  };
  const isDark = editorWindow.matchMedia?.(
    "(prefers-color-scheme: dark)",
  )?.matches;
  const editor = new EditorView({
    doc: dialogData.initialValue,
    extensions: [
      basicSetup,
      StreamLanguage.define(stexMath),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": dialogData.sourceLabel,
        spellcheck: "false",
      }),
      EditorView.domEventHandlers({
        keydown: (event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            !saveButton.disabled
          ) {
            event.preventDefault();
            save();
            return true;
          }
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) schedulePreview(update.state.doc.toString());
      }),
      EditorView.theme(
        {
          "&": {
            backgroundColor: "transparent",
            color: "inherit",
            height: "100%",
          },
          ".cm-content": {
            caretColor: "currentColor",
            padding: "10px 0",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            borderRight: "1px solid var(--fill-quaternary, #d7d7d7)",
            color: "var(--fill-secondary, #737373)",
          },
          ".cm-scroller": {
            fontFamily:
              'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
            fontSize: "14px",
            lineHeight: "1.55",
            overflow: "auto",
          },
        },
        { dark: Boolean(isDark) },
      ),
    ],
    parent: editorHost,
  });

  cancelButton.addEventListener("click", cancel);
  saveButton.addEventListener("click", save);
  updatePreview(dialogData.initialValue);
  editor.focus();
  editorWindow.focus();

  return () => {
    if (previewTimer !== undefined) editorWindow.clearTimeout(previewTimer);
    cancelButton.removeEventListener("click", cancel);
    saveButton.removeEventListener("click", save);
    editor.destroy();
  };
}

function requireElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof document.defaultView!.HTMLElement)) {
    throw new Error(`LaTeX editor is missing #${id}`);
  }
  return element;
}

function requireButton(document: Document, id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof document.defaultView!.HTMLButtonElement)) {
    throw new Error(`LaTeX editor is missing #${id}`);
  }
  return element;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function start(): void {
  const editorWindow = window as LatexEditorWindow;
  let dispose: (() => void) | undefined;
  try {
    dispose = initializeLatexEditor(editorWindow);
    editorWindow.addEventListener(
      "unload",
      () => {
        dispose?.();
        editorWindow.arguments?.[0]?.cancel();
      },
      { once: true },
    );
  } catch (error) {
    const normalized = toError(error);
    editorWindow.arguments?.[0]?.fail(normalized.message);
    editorWindow.close();
  }
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
