import { config } from "../package.json";
import {
  registerPrefs,
  registerPrefsScripts,
} from "./features/preferences/preferenceScript";
import { FigureGalleryController } from "./features/gallery/figureGalleryController";
import { FigureBatchController } from "./features/library/figureBatchController";
import { FigureReaderController } from "./features/reader/figureReaderController";
import { LayoutAnalyzer } from "./services/layout/layoutAnalyzer";
import { FigureGalleryIndex } from "./services/results/figureGalleryIndex";
import { FigureResultStore } from "./services/results/figureResultStore";
import { initLocale } from "./utils/locale";

const controllers = new Map<Window, FigureReaderController>();
const galleryControllers = new Map<Window, FigureGalleryController>();
const resultStore = new FigureResultStore();
const galleryIndex = new FigureGalleryIndex(resultStore);
const layoutAnalyzer = new LayoutAnalyzer(resultStore);
const batchController = new FigureBatchController(layoutAnalyzer, resultStore);

async function onStartup(): Promise<void> {
  await waitForZotero();
  initLocale();
  await registerPrefs();
  addon.api.gallery = {
    getBootstrap: () => galleryIndex.getBootstrap(),
    loadLibrary: (libraryID: number) => galleryIndex.loadLibrary(libraryID),
    openSource: (entryID: string) => galleryIndex.openSource(entryID),
    readImage: (entryID: string) => galleryIndex.readImage(entryID),
  };
  batchController.start();
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
  const galleryController = new FigureGalleryController(win);
  galleryControllers.set(win, galleryController);
  galleryController.start();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const controller = controllers.get(win);
  if (controller) {
    controllers.delete(win);
    controller.dispose();
  }
  const galleryController = galleryControllers.get(win);
  if (galleryController) {
    galleryControllers.delete(win);
    galleryController.dispose();
  }
}

async function onShutdown(): Promise<void> {
  batchController.dispose();
  for (const controller of [...controllers.values()].reverse()) {
    controller.dispose();
  }
  controllers.clear();
  for (const controller of [...galleryControllers.values()].reverse()) {
    controller.dispose();
  }
  galleryControllers.clear();
  delete addon.api.gallery;
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
