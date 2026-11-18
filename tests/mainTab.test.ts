import * as assert from "node:assert/strict";
import test from "node:test";
import { ZoteroMainTab } from "../src/platform/zotero/mainTab";

class TabElement {
  id = "";
  textContent = "";
  attributes = new Map<string, string>();
  children: TabElement[] = [];
  parent?: TabElement;

  constructor(
    readonly ownerDocument: TabDocument,
    readonly localName: string,
  ) {}

  append(child: TabElement) {
    child.parent = this;
    this.children.push(child);
  }

  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
  }
}

class TabDocument {
  documentElement = new TabElement(this, "window");

  createElementNS(_namespace: string, localName: string) {
    return new TabElement(this, localName);
  }

  getElementById(id: string) {
    return this.documentElement.children.find((child) => child.id === id);
  }
}

const options = {
  contentURL: "chrome://zoterofigure/content/gallery/index.html",
  iconName: "zoterofigure-gallery",
  iconURL: "chrome://zoterofigure/content/icons/favicon.png",
  title: "PDF Figure Library",
  type: "zoterofigure-gallery",
};

function installTabs() {
  const globals = globalThis as unknown as { ztoolkit: typeof ztoolkit };
  const previousToolkit = globals.ztoolkit;
  const doc = new TabDocument();
  let nextID = 0;
  let failCreation = false;
  const tabs = {
    _tabs: [] as Array<{
      id: string;
      container: TabElement;
      onClose: () => void;
    }>,
    selections: [] as string[],
    add({ onClose }: { onClose: () => void }) {
      const tab = {
        id: `tab-${++nextID}`,
        container: new TabElement(doc, "tab-content"),
        onClose,
      };
      this._tabs.push(tab);
      return tab;
    },
    select(id: string) {
      this.selections.push(id);
    },
    close(id: string) {
      const tab = this._tabs.find((item) => item.id === id);
      this._tabs = this._tabs.filter((item) => item.id !== id);
      tab?.onClose();
    },
  };
  globals.ztoolkit = {
    UI: {
      createElement(
        ownerDocument: TabDocument,
        localName: string,
        { attributes }: { attributes: Record<string, string> },
      ) {
        if (failCreation) throw new Error("browser creation failed");
        const element = new TabElement(ownerDocument, localName);
        element.attributes = new Map(Object.entries(attributes));
        return element;
      },
    },
  } as unknown as typeof ztoolkit;
  const window = { document: doc, Zotero_Tabs: tabs } as unknown as Window;
  return {
    doc,
    tabs,
    window,
    failCreation: () => (failCreation = true),
    restore: () => (globals.ztoolkit = previousToolkit),
  };
}

test("gallery browsers stay in process under both Zotero 10 and 11 remote semantics", () => {
  const host = installTabs();
  const tab = new ZoteroMainTab(host.window, options);
  try {
    tab.open();
    const browser = host.tabs._tabs[0].container.children[0];
    assert.equal(browser.ownerDocument, host.doc);
    assert.equal(browser.localName, "browser");
    assert.equal(browser.attributes.get("type"), "content");
    assert.equal(browser.attributes.get("src"), options.contentURL);
    // Zotero 10 checks the value; Zotero 11 checks attribute presence.
    assert.equal(browser.attributes.get("remote") === "true", false);
    assert.equal(browser.attributes.has("remote"), false);
    assert.deepEqual(host.tabs.selections, [host.tabs._tabs[0].id]);
  } finally {
    tab.dispose();
    host.restore();
  }
});

test("reopening selects the existing gallery and closing allows a fresh document", () => {
  const host = installTabs();
  const tab = new ZoteroMainTab(host.window, options);
  try {
    tab.open();
    const first = host.tabs._tabs[0];
    tab.open();
    assert.equal(host.tabs._tabs.length, 1);
    assert.equal(host.doc.documentElement.children.length, 1);
    assert.deepEqual(host.tabs.selections, [first.id, first.id]);
    host.tabs.close(first.id);
    tab.open();
    assert.equal(host.tabs._tabs.length, 1);
    assert.notEqual(host.tabs._tabs[0].id, first.id);
    tab.dispose();
    tab.dispose();
    assert.equal(host.tabs._tabs.length, 0);
    assert.equal(host.doc.documentElement.children.length, 0);
  } finally {
    tab.dispose();
    host.restore();
  }
});

test("failed browser creation closes its partial tab and removes resources on dispose", () => {
  const host = installTabs();
  const tab = new ZoteroMainTab(host.window, options);
  try {
    host.failCreation();
    assert.throws(() => tab.open(), /browser creation failed/);
    assert.equal(host.tabs._tabs.length, 0);
    assert.deepEqual(host.tabs.selections, []);
    tab.dispose();
    assert.equal(host.doc.documentElement.children.length, 0);
  } finally {
    tab.dispose();
    host.restore();
  }
});
