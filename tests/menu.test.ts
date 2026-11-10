import * as assert from "node:assert/strict";
import test from "node:test";
import {
  createLegacyMenu,
  registerWindowMenu,
} from "../src/platform/zotero/menu";

class MenuElement extends EventTarget {
  id = "";
  children: MenuElement[] = [];
  parent?: MenuElement;
  attributes = new Map<string, string>();
  classList = { add: () => {} };
  style = { setProperty: () => {} };

  constructor(
    readonly ownerDocument: MenuDocument,
    readonly tag: string,
  ) {
    super();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  toggleAttribute(name: string, value: boolean) {
    if (value) this.setAttribute(name, "true");
    else this.attributes.delete(name);
  }
  appendChild(child: MenuElement) {
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

class MenuDocument {
  popup = new MenuElement(this, "menupopup");
  createXULElement(tag: string) {
    return new MenuElement(this, tag);
  }
  querySelector(selector: string) {
    return selector === "#zotero-itemmenu" ? this.popup : null;
  }
}

test("legacy menus show predicates, dispatch commands, update and remove listeners", () => {
  const doc = new MenuDocument();
  const menu = createLegacyMenu(doc as unknown as Document);
  let visible = false;
  let showing = 0;
  let commands = 0;
  const options = {
    id: "figures",
    tag: "menu" as const,
    label: "Figures",
    isHidden: () => {
      showing++;
      return !visible;
    },
    children: [
      {
        tag: "menuitem" as const,
        label: "Analyze",
        commandListener: () => commands++,
      },
    ],
  };
  menu.register("item", options);
  const root = doc.popup.children[0];
  const item = root.children[0].children[0];
  assert.equal(root.attributes.has("disabled"), false);
  assert.equal(item.attributes.has("checked"), false);
  doc.popup.dispatchEvent(new Event("popupshowing"));
  assert.equal(root.attributes.get("hidden"), "true");
  visible = true;
  doc.popup.dispatchEvent(new Event("popupshowing"));
  assert.equal(root.attributes.has("hidden"), false);
  item.dispatchEvent(new Event("command"));
  assert.equal(commands, 1);
  menu.register("item", {
    id: "figures",
    tag: "menuitem",
    label: "Replacement",
  });
  assert.equal(doc.popup.children.length, 1);
  assert.equal(doc.popup.children[0].attributes.get("label"), "Replacement");
  doc.popup.dispatchEvent(new Event("popupshowing"));
  item.dispatchEvent(new Event("command"));
  assert.equal(showing, 2);
  assert.equal(commands, 1);
  menu.unregister("figures");
  menu.unregister("figures");
  assert.equal(doc.popup.children.length, 0);
  assert.equal(menu.register("collection", options), false);
});

test("disposed window menus ignore pending visibility predicates", async () => {
  const doc = new MenuDocument();
  let resolve!: (visible: boolean) => void;
  const visibility = new Promise<boolean>((done) => {
    resolve = done;
  });
  const handle = registerWindowMenu(doc.popup as unknown as Element, {
    tag: "menuitem",
    hidden: true,
    getVisibility: () => visibility,
  });
  const root = doc.popup.children[0];
  doc.popup.dispatchEvent(new Event("popupshowing"));
  handle.dispose();
  resolve(true);
  await visibility;
  assert.equal(root.attributes.get("hidden"), "true");
  assert.equal(doc.popup.children.length, 0);
});
