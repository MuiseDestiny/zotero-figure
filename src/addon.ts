import type { DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

interface LocaleFormatter {
  formatMessagesSync(
    messages: Array<{ args?: Record<string, unknown>; id: string }>,
  ): Array<{
    attributes?: Record<string, string>;
    value?: string;
  }>;
}

export interface AddonData {
  alive: boolean;
  dialog?: DialogHelper;
  env: "development" | "production";
  locale?: { current: LocaleFormatter };
  ztoolkit: ZToolkit;
}

class Addon {
  public readonly api: Record<string, unknown> = {};
  public readonly data: AddonData;
  public readonly hooks = hooks;

  constructor() {
    this.data = {
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
    };
  }
}

export default Addon;
