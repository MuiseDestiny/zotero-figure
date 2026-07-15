import { config } from "../../../package.json";
import { ZoteroMainTab } from "../../platform/zotero/mainTab";
import { getString } from "../../utils/locale";

const MENU_ID = `${config.addonRef}-open-gallery`;
const TAB_TYPE = `${config.addonRef}-gallery`;

export class FigureGalleryController {
  private readonly tab: ZoteroMainTab;
  private started = false;

  constructor(private readonly window: Window) {
    this.tab = new ZoteroMainTab(window, {
      contentURL: `chrome://${config.addonRef}/content/gallery/index.html?v=${Date.now()}`,
      iconName: `${config.addonRef}-gallery`,
      iconURL: `chrome://${config.addonRef}/content/icons/favicon.png`,
      title: getString("gallery-title"),
      type: TAB_TYPE,
    });
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    const popup = this.window.document.querySelector(
      "#menu_ToolsPopup",
    ) as XUL.MenuPopup | null;
    if (!popup) return;
    ztoolkit.Menu.register(popup, {
      commandListener: () => this.open(),
      icon: `chrome://${config.addonRef}/content/icons/favicon.png`,
      id: MENU_ID,
      label: getString("gallery-menu-open"),
      tag: "menuitem",
    });
  }

  public open(): void {
    this.tab.open();
  }

  public dispose(): void {
    this.window.document.getElementById(MENU_ID)?.remove();
    this.tab.dispose();
    this.started = false;
  }
}
