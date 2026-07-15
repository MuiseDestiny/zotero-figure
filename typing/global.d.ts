declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ZoteroPane: _ZoteroTypes.ZoteroPane;
  Zotero_Tabs: typeof Zotero_Tabs;
  window: Window;
  document: Document;
  ztoolkit: ZToolkit;
  addon: typeof addon;
  CustomEvent: typeof CustomEvent;
  NodeFilter: typeof NodeFilter;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare const __pluginIconDataURL__: string;

declare class Localization {
  constructor(resourceIDs: string[], sync?: boolean);
  formatMessagesSync(
    messages: Array<{ args?: Record<string, unknown>; id: string }>,
  ): Array<{
    attributes?: Record<string, string>;
    value?: string;
  }>;
}
