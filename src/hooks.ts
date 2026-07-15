import { config } from "../package.json";
import {
  registerPrefs,
  registerPrefsScripts,
} from "./features/preferences/preferenceScript";
import { FigureReaderController } from "./features/reader/figureReaderController";
import { LayoutAnalyzer } from "./services/layout/layoutAnalyzer";
import { FigureResultStore } from "./services/results/figureResultStore";
import { initLocale } from "./utils/locale";

const controllers = new Map<Window, FigureReaderController>();
const resultStore = new FigureResultStore();
const layoutAnalyzer = new LayoutAnalyzer(resultStore);

async function onStartup(): Promise<void> {
  await waitForZotero();
  initLocale();
  await registerPrefs();
  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  if (controllers.has(win)) return;
  const controller = new FigureReaderController(win, {
    layoutAnalyzer,
    resultStore,
  });
  controllers.set(win, controller);
  controller.start();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const controller = controllers.get(win);
  if (!controller) return;
  controllers.delete(win);
  controller.dispose();
}

async function onShutdown(): Promise<void> {
  for (const controller of [...controllers.values()].reverse()) {
    controller.dispose();
  }
  controllers.clear();
  layoutAnalyzer.dispose();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  addon.data.alive = false;
  delete (Zotero as typeof Zotero & Record<string, unknown>)[
    config.addonInstance
  ];
}

async function onPrefsEvent(
  type: string,
  data: { window: Window },
): Promise<void> {
  if (type === "load") registerPrefsScripts(data.window);
}

async function waitForZotero(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
