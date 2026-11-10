import {
  BasicTool,
  DialogHelper,
  makeHelperTool,
  ProgressWindowHelper,
  UITool,
  unregister,
} from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

// Keep only the toolkit 6 modules used by the plugin.
class FigureToolkit extends BasicTool {
  UI = new UITool(this);
  ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
  Dialog = makeHelperTool(DialogHelper, this);

  unregisterAll(): void {
    unregister(this);
  }
}

function createZToolkit() {
  const _ztoolkit = new FigureToolkit();
  initZToolkit(_ztoolkit);
  return _ztoolkit;
}

function initZToolkit(_ztoolkit: ReturnType<typeof createZToolkit>) {
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = false;
  _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = false;
  _ztoolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
  _ztoolkit.ProgressWindow.setIconURI(
    "success",
    `chrome://${config.addonRef}/content/icons/tick.png`,
  );
  _ztoolkit.ProgressWindow.setIconURI(
    "fail",
    `chrome://${config.addonRef}/content/icons/cross.png`,
  );
}
