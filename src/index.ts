import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";
import { createRealmSafeBlobConstructor } from "./platform/zotero/browserGlobals";

const basicTool = new BasicTool();
const zotero = basicTool.getGlobal("Zotero");
const registry = zotero as typeof Zotero & Record<string, unknown>;

// Browser constructors are not guaranteed to exist on the plugin sandbox
// global. Resolve them from the current Zotero window, then fall back to the
// hidden DOM window for startup/shutdown periods without an open main window.
const initialWindow = basicTool.getGlobal("window") as Window | undefined;
const blobConstructors = new WeakMap<object, typeof Blob>();
const windowBoundGlobals = new Set([
  "atob",
  "btoa",
  "cancelAnimationFrame",
  "clearInterval",
  "clearTimeout",
  "fetch",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
]);

if (!registry[config.addonInstance]) {
  _globalThis.Zotero = zotero;
  defineGlobal("window", () => resolveBrowserGlobal("window"));
  defineGlobal("document", () => resolveBrowserGlobal("document"));
  defineGlobal("ZoteroPane");
  defineGlobal("Zotero_Tabs");
  for (const name of [
    "AbortController",
    "AbortSignal",
    "atob",
    "btoa",
    "Blob",
    "DOMException",
    "File",
    "FileReader",
    "fetch",
    "FormData",
    "Headers",
    "MutationObserver",
    "ReadableStream",
    "Request",
    "Response",
    "TextDecoder",
    "TextEncoder",
    "URL",
    "URLSearchParams",
    "Worker",
    "cancelAnimationFrame",
    "clearInterval",
    "clearTimeout",
    "navigator",
    "requestAnimationFrame",
    "setInterval",
    "setTimeout",
  ]) {
    defineGlobal(name, () => resolveBrowserGlobal(name));
  }
  _globalThis.addon = new Addon();
  _globalThis.CustomEvent = window.CustomEvent;
  _globalThis.NodeFilter = window.NodeFilter;
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);
  registry[config.addonInstance] = addon;
}

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => unknown): void;
function defineGlobal(name: string, getter?: () => unknown): void {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}

function resolveBrowserGlobal(name: string): unknown {
  const sources = [getMainWindow(), getHiddenDOMWindow(), initialWindow];
  for (const source of sources) {
    if (!source) continue;
    try {
      const value = (source as Window & Record<string, unknown>)[name];
      if (value !== undefined) {
        if (name === "Blob" && typeof value === "function") {
          return getRealmSafeBlobConstructor(source, value as typeof Blob);
        }
        return typeof value === "function" && windowBoundGlobals.has(name)
          ? value.bind(source)
          : value;
      }
    } catch {
      // Try the next browser global source.
    }
  }
  return undefined;
}

function getRealmSafeBlobConstructor(
  source: Window,
  nativeBlob: typeof Blob,
): typeof Blob {
  const existing = blobConstructors.get(source);
  if (existing) return existing;
  const constructor = createRealmSafeBlobConstructor(
    nativeBlob,
    source,
    (value, target) => Components.utils.cloneInto(value, target),
  );
  blobConstructors.set(source, constructor);
  return constructor;
}

function getMainWindow(): Window | undefined {
  try {
    return zotero.getMainWindow?.() ?? undefined;
  } catch {
    return undefined;
  }
}

function getHiddenDOMWindow(): Window | undefined {
  try {
    return (
      Services as unknown as {
        appShell?: { hiddenDOMWindow?: Window };
      }
    ).appShell?.hiddenDOMWindow;
  } catch {
    return undefined;
  }
}
