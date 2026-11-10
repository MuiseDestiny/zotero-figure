/** Plugin-owned menu descriptors, independent of toolkit's removed Menu API. */
export interface MenuitemOptions {
  tag: "menuitem" | "menu" | "menuseparator";
  id?: string;
  label?: string;
  icon?: string;
  hidden?: boolean;
  disabled?: boolean;
  children?: MenuitemOptions[];
  commandListener?: EventListenerOrEventListenerObject;
  isHidden?: MenuPredicate;
  getVisibility?: MenuPredicate;
  isDisabled?: MenuPredicate;
  onShowing?: (element: Element, event: Event) => unknown;
}

type MenuPredicate = (
  element: Element,
  event: Event,
) => boolean | undefined | Promise<boolean | undefined>;

export interface LegacyMenu {
  register(
    target: "item" | "collection",
    options: MenuitemOptions,
  ): false | void;
  unregister(id: string): void;
}

export interface WindowMenuHandle {
  dispose(): void;
}

/** Zotero 9/10 menus use XUL DOM; retain every listener for explicit cleanup. */
export function registerWindowMenu(
  popup: Element,
  options: MenuitemOptions,
  report: (error: unknown) => void = (error) =>
    Zotero.logError(error instanceof Error ? error : new Error(String(error))),
): WindowMenuHandle {
  let active = true;
  const cleanups: Array<() => void> = [];
  const doc = popup.ownerDocument;
  const listen = (target: Element, type: string, listener: EventListener) => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };
  const predicate = (
    callback: MenuPredicate | undefined,
    element: Element,
    event: Event,
    attribute: "hidden" | "disabled",
    invert = false,
  ) => {
    if (!callback) return;
    const apply = (value: boolean | undefined) => {
      if (active && value !== undefined)
        element.toggleAttribute(attribute, invert ? !value : value);
    };
    const value = callback(element, event);
    if (value && typeof value === "object")
      void Promise.resolve(value).then(apply, report);
    else apply(value);
  };
  const create = (item: MenuitemOptions, parentPopup: Element): Element => {
    const element = doc.createXULElement(item.tag) as Element & {
      style: CSSStyleDeclaration;
    };
    if (item.id) element.id = item.id;
    if (item.label) element.setAttribute("label", item.label);
    if (item.hidden) element.setAttribute("hidden", "true");
    if (item.disabled) element.setAttribute("disabled", "true");
    if (item.icon) {
      element.classList.add(
        item.tag === "menu" ? "menu-iconic" : "menuitem-iconic",
      );
      element.style.setProperty(
        "list-style-image",
        `url(${JSON.stringify(item.icon)})`,
      );
    }
    if (item.commandListener) {
      const listener = item.commandListener;
      listen(element, "command", (event) => {
        try {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        } catch (error) {
          report(error);
        }
      });
    }
    if (
      item.isHidden ||
      item.getVisibility ||
      item.isDisabled ||
      item.onShowing
    ) {
      listen(parentPopup, "popupshowing", (event) => {
        if (event.target !== parentPopup) return;
        try {
          predicate(
            item.isHidden ?? item.getVisibility,
            element,
            event,
            "hidden",
            !item.isHidden,
          );
          predicate(item.isDisabled, element, event, "disabled");
          if (item.onShowing)
            void Promise.resolve(item.onShowing(element, event)).catch(report);
        } catch (error) {
          report(error);
        }
      });
    }
    if (item.tag === "menu") {
      const childPopup = doc.createXULElement("menupopup");
      for (const child of item.children ?? [])
        childPopup.appendChild(create(child, childPopup));
      element.appendChild(childPopup);
    }
    return element;
  };
  let root: Element;
  try {
    root = create(options, popup);
    popup.appendChild(root);
  } catch (error) {
    for (const cleanup of cleanups.reverse()) cleanup();
    throw error;
  }
  return {
    dispose() {
      if (!active) return;
      active = false;
      for (const cleanup of cleanups.reverse()) cleanup();
      root.remove();
    },
  };
}

export function createLegacyMenu(
  doc: Document = Zotero.getMainWindow().document,
  report?: (error: unknown) => void,
): LegacyMenu {
  const handles = new Map<string, WindowMenuHandle>();
  return {
    register(target, options) {
      const popup = doc.querySelector(
        target === "item" ? "#zotero-itemmenu" : "#zotero-collectionmenu",
      );
      if (!popup || !options.id) return false;
      handles.get(options.id)?.dispose();
      handles.set(options.id, registerWindowMenu(popup, options, report));
    },
    unregister(id) {
      handles.get(id)?.dispose();
      handles.delete(id);
    },
  };
}
