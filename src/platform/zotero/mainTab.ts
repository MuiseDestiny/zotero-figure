interface ZoteroMainWindow extends Window {
  Zotero_Tabs?: typeof Zotero_Tabs;
}

export interface ZoteroMainTabOptions {
  contentURL: string;
  iconName: string;
  iconURL: string;
  title: string;
  type: string;
}

export class ZoteroMainTab {
  private tabID?: string;

  constructor(
    private readonly window: Window,
    private readonly options: ZoteroMainTabOptions,
  ) {}

  public open(): void {
    const tabs = this.getTabs();
    this.ensureIconStyle();
    if (this.tabID && tabs._tabs.some(({ id }) => id === this.tabID)) {
      tabs.select(this.tabID);
      return;
    }

    const tab = tabs.add({
      data: { icon: this.options.iconName },
      onClose: () => {
        if (this.tabID === tab.id) this.tabID = undefined;
      },
      title: this.options.title,
      type: this.options.type,
    });
    this.tabID = tab.id;
    try {
      const browser = ztoolkit.UI.createElement(
        tab.container.ownerDocument,
        "browser",
        {
          attributes: {
            disableglobalhistory: "true",
            flex: "1",
            remote: "false",
            src: this.options.contentURL,
            type: "content",
          },
          namespace: "xul",
        },
      );
      tab.container.append(browser);
      tabs.select(tab.id);
    } catch (error) {
      this.tabID = undefined;
      tabs.close(tab.id);
      throw error;
    }
  }

  public dispose(): void {
    if (this.tabID) {
      try {
        this.getTabs().close(this.tabID);
      } catch {
        // The owning Zotero window may already be tearing down.
      }
      this.tabID = undefined;
    }
    this.window.document.getElementById(this.getIconStyleID())?.remove();
  }

  private getTabs(): typeof Zotero_Tabs {
    return (this.window as ZoteroMainWindow).Zotero_Tabs ?? Zotero_Tabs;
  }

  private ensureIconStyle(): void {
    const document = this.window.document;
    if (document.getElementById(this.getIconStyleID())) return;
    const style = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "style",
    );
    style.id = this.getIconStyleID();
    style.textContent = `.tab-icon.icon-item-type[data-item-type="${this.options.iconName}"] { background: url("${this.options.iconURL}") no-repeat center / contain !important; }`;
    document.documentElement.append(style);
  }

  private getIconStyleID(): string {
    return `${this.options.type}-icon-style`;
  }
}
