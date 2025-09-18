"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };

  // node_modules/zotero-plugin-toolkit/dist/utils/debugBridge.js
  var _DebugBridge = class {
    get version() {
      return _DebugBridge.version;
    }
    _disableDebugBridgePassword;
    get disableDebugBridgePassword() {
      return this._disableDebugBridgePassword;
    }
    set disableDebugBridgePassword(value) {
      this._disableDebugBridgePassword = value;
    }
    get password() {
      return BasicTool.getZotero().Prefs.get(_DebugBridge.passwordPref, true);
    }
    set password(v) {
      BasicTool.getZotero().Prefs.set(_DebugBridge.passwordPref, v, true);
    }
    constructor() {
      this._disableDebugBridgePassword = false;
      this.initializeDebugBridge();
    }
    static setModule(instance) {
      if (!instance.debugBridge?.version || instance.debugBridge.version < _DebugBridge.version) {
        instance.debugBridge = new _DebugBridge();
      }
    }
    initializeDebugBridge() {
      const debugBridgeExtension = {
        noContent: true,
        doAction: async (uri) => {
          const Zotero2 = BasicTool.getZotero();
          const window2 = Zotero2.getMainWindow();
          const uriString = uri.spec.split("//").pop();
          if (!uriString) {
            return;
          }
          const params = {};
          uriString.split("?").pop()?.split("&").forEach((p) => {
            params[p.split("=")[0]] = decodeURIComponent(p.split("=")[1]);
          });
          const skipPasswordCheck = toolkitGlobal_default.getInstance()?.debugBridge.disableDebugBridgePassword;
          let allowed = false;
          if (skipPasswordCheck) {
            allowed = true;
          } else {
            if (typeof params.password === "undefined" && typeof this.password === "undefined") {
              allowed = window2.confirm(`External App ${params.app} wants to execute command without password.
Command:
${(params.run || params.file || "").slice(0, 100)}
If you do not know what it is, please click Cancel to deny.`);
            } else {
              allowed = this.password === params.password;
            }
          }
          if (allowed) {
            if (params.run) {
              try {
                const AsyncFunction = Object.getPrototypeOf(async () => {
                }).constructor;
                const f = new AsyncFunction("Zotero,window", params.run);
                await f(Zotero2, window2);
              } catch (e) {
                Zotero2.debug(e);
                window2.console.log(e);
              }
            }
            if (params.file) {
              try {
                Services.scriptloader.loadSubScript(params.file, {
                  Zotero: Zotero2,
                  window: window2
                });
              } catch (e) {
                Zotero2.debug(e);
                window2.console.log(e);
              }
            }
          }
        },
        newChannel(uri) {
          this.doAction(uri);
        }
      };
      Services.io.getProtocolHandler("zotero").wrappedJSObject._extensions["zotero://ztoolkit-debug"] = debugBridgeExtension;
    }
  };
  var DebugBridge = _DebugBridge;
  __publicField(DebugBridge, "version", 2);
  __publicField(DebugBridge, "passwordPref", "extensions.zotero.debug-bridge.password");

  // node_modules/zotero-plugin-toolkit/dist/utils/pluginBridge.js
  var _PluginBridge = class {
    get version() {
      return _PluginBridge.version;
    }
    constructor() {
      this.initializePluginBridge();
    }
    static setModule(instance) {
      if (!instance.pluginBridge?.version || instance.pluginBridge.version < _PluginBridge.version) {
        instance.pluginBridge = new _PluginBridge();
      }
    }
    initializePluginBridge() {
      const { AddonManager } = _importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const Zotero2 = BasicTool.getZotero();
      const pluginBridgeExtension = {
        noContent: true,
        doAction: async (uri) => {
          try {
            const uriString = uri.spec.split("//").pop();
            if (!uriString) {
              return;
            }
            const params = {};
            uriString.split("?").pop()?.split("&").forEach((p) => {
              params[p.split("=")[0]] = decodeURIComponent(p.split("=")[1]);
            });
            if (params.action === "install" && params.url) {
              if (params.minVersion && Services.vc.compare(Zotero2.version, params.minVersion) < 0 || params.maxVersion && Services.vc.compare(Zotero2.version, params.maxVersion) > 0) {
                throw new Error(`Plugin is not compatible with Zotero version ${Zotero2.version}.The plugin requires Zotero version between ${params.minVersion} and ${params.maxVersion}.`);
              }
              const addon2 = await AddonManager.getInstallForURL(params.url);
              if (addon2 && addon2.state === AddonManager.STATE_AVAILABLE) {
                addon2.install();
                hint("Plugin installed successfully.", true);
              } else {
                throw new Error(`Plugin ${params.url} is not available.`);
              }
            }
          } catch (e) {
            Zotero2.logError(e);
            hint(e.message, false);
          }
        },
        newChannel(uri) {
          this.doAction(uri);
        }
      };
      Services.io.getProtocolHandler("zotero").wrappedJSObject._extensions["zotero://plugin"] = pluginBridgeExtension;
    }
  };
  var PluginBridge = _PluginBridge;
  __publicField(PluginBridge, "version", 1);
  function hint(content, success) {
    const progressWindow = new Zotero.ProgressWindow({ closeOnClick: true });
    progressWindow.changeHeadline("Plugin Toolkit");
    progressWindow.progress = new progressWindow.ItemProgress(success ? "chrome://zotero/skin/tick.png" : "chrome://zotero/skin/cross.png", content);
    progressWindow.progress.setProgress(100);
    progressWindow.show();
    progressWindow.startCloseTimer(5e3);
  }

  // node_modules/zotero-plugin-toolkit/dist/managers/toolkitGlobal.js
  var ToolkitGlobal = class {
    debugBridge;
    pluginBridge;
    prompt;
    currentWindow;
    constructor() {
      initializeModules(this);
      this.currentWindow = BasicTool.getZotero().getMainWindow();
    }
    /**
     * Get the global unique instance of `class ToolkitGlobal`.
     * @returns An instance of `ToolkitGlobal`.
     */
    static getInstance() {
      let _Zotero;
      try {
        if (typeof Zotero !== "undefined") {
          _Zotero = Zotero;
        } else {
          _Zotero = BasicTool.getZotero();
        }
      } catch {
      }
      if (!_Zotero) {
        return void 0;
      }
      let requireInit = false;
      if (!("_toolkitGlobal" in _Zotero)) {
        _Zotero._toolkitGlobal = new ToolkitGlobal();
        requireInit = true;
      }
      const currentGlobal = _Zotero._toolkitGlobal;
      if (currentGlobal.currentWindow !== _Zotero.getMainWindow()) {
        checkWindowDependentModules(currentGlobal);
        requireInit = true;
      }
      if (requireInit) {
        initializeModules(currentGlobal);
      }
      return currentGlobal;
    }
  };
  function initializeModules(instance) {
    new BasicTool().log("Initializing ToolkitGlobal modules");
    setModule(instance, "prompt", {
      _ready: false,
      instance: void 0
    });
    DebugBridge.setModule(instance);
    PluginBridge.setModule(instance);
  }
  function setModule(instance, key, module) {
    if (!module) {
      return;
    }
    if (!instance[key]) {
      instance[key] = module;
    }
    for (const moduleKey in module) {
      instance[key][moduleKey] ??= module[moduleKey];
    }
  }
  function checkWindowDependentModules(instance) {
    instance.currentWindow = BasicTool.getZotero().getMainWindow();
    instance.prompt = void 0;
  }
  var toolkitGlobal_default = ToolkitGlobal;

  // node_modules/zotero-plugin-toolkit/dist/version.js
  var VERSION = "5.1.0-beta.4";

  // node_modules/zotero-plugin-toolkit/dist/basic.js
  var _BasicTool = class {
    /**
     * configurations.
     */
    _basicOptions;
    _console;
    /**
     * @deprecated Use `patcherManager` instead.
     */
    patchSign = "zotero-plugin-toolkit@3.0.0";
    /**
     * Get version - checks subclass first, then falls back to parent
     */
    get _version() {
      return VERSION;
    }
    get basicOptions() {
      return this._basicOptions;
    }
    /**
     *
     * @param data Pass an BasicTool instance to copy its options.
     */
    constructor(data) {
      this._basicOptions = {
        log: {
          _type: "toolkitlog",
          disableConsole: false,
          disableZLog: false,
          prefix: ""
        },
        // We will remove this in the future, for now just let it be lazy loaded.
        get debug() {
          if (this._debug) {
            return this._debug;
          }
          this._debug = toolkitGlobal_default.getInstance()?.debugBridge || {
            disableDebugBridgePassword: false,
            password: ""
          };
          return this._debug;
        },
        api: {
          pluginID: "zotero-plugin-toolkit@windingwind.com"
        },
        listeners: {
          callbacks: {
            onMainWindowLoad: /* @__PURE__ */ new Set(),
            onMainWindowUnload: /* @__PURE__ */ new Set(),
            onPluginUnload: /* @__PURE__ */ new Set()
          },
          _mainWindow: void 0,
          _plugin: void 0
        }
      };
      try {
        if (typeof globalThis.ChromeUtils?.importESModule !== "undefined" || typeof globalThis.ChromeUtils?.import !== "undefined") {
          const { ConsoleAPI } = _importESModule("resource://gre/modules/Console.sys.mjs");
          this._console = new ConsoleAPI({
            consoleID: `${this._basicOptions.api.pluginID}-${Date.now()}`
          });
        }
      } catch {
      }
      this.updateOptions(data);
    }
    getGlobal(k) {
      if (typeof globalThis[k] !== "undefined") {
        return globalThis[k];
      }
      const _Zotero = _BasicTool.getZotero();
      try {
        const window2 = _Zotero.getMainWindow();
        switch (k) {
          case "Zotero":
          case "zotero":
            return _Zotero;
          case "window":
            return window2;
          case "windows":
            return _Zotero.getMainWindows();
          case "document":
            return window2.document;
          case "ZoteroPane":
          case "ZoteroPane_Local":
            return _Zotero.getActiveZoteroPane();
          default:
            return window2[k];
        }
      } catch (e) {
        Zotero.logError(e);
      }
    }
    /**
     * If it's an XUL element
     * @param elem
     */
    isXULElement(elem) {
      return elem.namespaceURI === "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    }
    /**
     * Create an XUL element
     *
     * For Zotero 6, use `createElementNS`;
     *
     * For Zotero 7+, use `createXULElement`.
     * @param doc
     * @param type
     * @example
     * Create a `<menuitem>`:
     * ```ts
     * const compat = new ZoteroCompat();
     * const doc = compat.getWindow().document;
     * const elem = compat.createXULElement(doc, "menuitem");
     * ```
     */
    createXULElement(doc, type) {
      return doc.createXULElement(type);
    }
    /**
     * Output to both Zotero.debug and console.log
     * @param data e.g. string, number, object, ...
     */
    log(...data) {
      if (data.length === 0) {
        return;
      }
      let _Zotero;
      try {
        if (typeof Zotero !== "undefined") {
          _Zotero = Zotero;
        } else {
          _Zotero = _BasicTool.getZotero();
        }
      } catch {
      }
      let options;
      if (data[data.length - 1]?._type === "toolkitlog") {
        options = data.pop();
      } else {
        options = this._basicOptions.log;
      }
      try {
        if (options.prefix) {
          data.splice(0, 0, options.prefix);
        }
        if (!options.disableConsole) {
          let _console;
          if (typeof console !== "undefined") {
            _console = console;
          } else if (_Zotero) {
            _console = _Zotero.getMainWindow()?.console;
          }
          if (!_console) {
            if (!this._console) {
              return;
            }
            _console = this._console;
          }
          if (_console.groupCollapsed) {
            _console.groupCollapsed(...data);
          } else {
            _console.group(...data);
          }
          _console.trace();
          _console.groupEnd();
        }
        if (!options.disableZLog) {
          if (typeof _Zotero === "undefined") {
            return;
          }
          _Zotero.debug(data.map((d) => {
            try {
              return typeof d === "object" ? JSON.stringify(d) : String(d);
            } catch {
              _Zotero.debug(d);
              return "";
            }
          }).join("\n"));
        }
      } catch (e) {
        if (_Zotero)
          Zotero.logError(e);
        else {
          console.error(e);
        }
      }
    }
    /**
     * Patch a function
     * @deprecated Use {@link PatchHelper} instead.
     * @param object The owner of the function
     * @param funcSign The signature of the function(function name)
     * @param ownerSign The signature of patch owner to avoid patching again
     * @param patcher The new wrapper of the patched function
     */
    patch(object, funcSign, ownerSign, patcher) {
      if (object[funcSign][ownerSign]) {
        throw new Error(`${String(funcSign)} re-patched`);
      }
      this.log("patching", funcSign, `by ${ownerSign}`);
      object[funcSign] = patcher(object[funcSign]);
      object[funcSign][ownerSign] = true;
    }
    /**
     * Add a Zotero event listener callback
     * @param type Event type
     * @param callback Event callback
     */
    addListenerCallback(type, callback) {
      if (["onMainWindowLoad", "onMainWindowUnload"].includes(type)) {
        this._ensureMainWindowListener();
      }
      if (type === "onPluginUnload") {
        this._ensurePluginListener();
      }
      this._basicOptions.listeners.callbacks[type].add(callback);
    }
    /**
     * Remove a Zotero event listener callback
     * @param type Event type
     * @param callback Event callback
     */
    removeListenerCallback(type, callback) {
      this._basicOptions.listeners.callbacks[type].delete(callback);
      this._ensureRemoveListener();
    }
    /**
     * Remove all Zotero event listener callbacks when the last callback is removed.
     */
    _ensureRemoveListener() {
      const { listeners } = this._basicOptions;
      if (listeners._mainWindow && listeners.callbacks.onMainWindowLoad.size === 0 && listeners.callbacks.onMainWindowUnload.size === 0) {
        Services.wm.removeListener(listeners._mainWindow);
        delete listeners._mainWindow;
      }
      if (listeners._plugin && listeners.callbacks.onPluginUnload.size === 0) {
        Zotero.Plugins.removeObserver(listeners._plugin);
        delete listeners._plugin;
      }
    }
    /**
     * Ensure the main window listener is registered.
     */
    _ensureMainWindowListener() {
      if (this._basicOptions.listeners._mainWindow) {
        return;
      }
      const mainWindowListener = {
        onOpenWindow: (xulWindow) => {
          const domWindow = xulWindow.docShell.domWindow;
          const onload = async () => {
            domWindow.removeEventListener("load", onload, false);
            if (domWindow.location.href !== "chrome://zotero/content/zoteroPane.xhtml") {
              return;
            }
            for (const cbk of this._basicOptions.listeners.callbacks.onMainWindowLoad) {
              try {
                cbk(domWindow);
              } catch (e) {
                this.log(e);
              }
            }
          };
          domWindow.addEventListener("load", () => onload(), false);
        },
        onCloseWindow: async (xulWindow) => {
          const domWindow = xulWindow.docShell.domWindow;
          if (domWindow.location.href !== "chrome://zotero/content/zoteroPane.xhtml") {
            return;
          }
          for (const cbk of this._basicOptions.listeners.callbacks.onMainWindowUnload) {
            try {
              cbk(domWindow);
            } catch (e) {
              this.log(e);
            }
          }
        }
      };
      this._basicOptions.listeners._mainWindow = mainWindowListener;
      Services.wm.addListener(mainWindowListener);
    }
    /**
     * Ensure the plugin listener is registered.
     */
    _ensurePluginListener() {
      if (this._basicOptions.listeners._plugin) {
        return;
      }
      const pluginListener = {
        shutdown: (...args) => {
          for (const cbk of this._basicOptions.listeners.callbacks.onPluginUnload) {
            try {
              cbk(...args);
            } catch (e) {
              this.log(e);
            }
          }
        }
      };
      this._basicOptions.listeners._plugin = pluginListener;
      Zotero.Plugins.addObserver(pluginListener);
    }
    updateOptions(source) {
      if (!source) {
        return this;
      }
      if (source instanceof _BasicTool) {
        this._basicOptions = source._basicOptions;
      } else {
        this._basicOptions = source;
      }
      return this;
    }
    static getZotero() {
      if (typeof Zotero !== "undefined") {
        return Zotero;
      }
      const { Zotero: _Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");
      return _Zotero;
    }
  };
  var BasicTool = _BasicTool;
  __publicField(BasicTool, "_version", VERSION);
  var ManagerTool = class extends BasicTool {
    _ensureAutoUnregisterAll() {
      this.addListenerCallback("onPluginUnload", (params, _reason) => {
        if (params.id !== this.basicOptions.api.pluginID) {
          return;
        }
        this.unregisterAll();
      });
    }
  };
  function unregister(tools) {
    Object.values(tools).forEach((tool) => {
      if (tool instanceof ManagerTool || typeof tool?.unregisterAll === "function") {
        tool.unregisterAll();
      }
    });
  }
  function makeHelperTool(cls, options) {
    return new Proxy(cls, {
      construct(target, args) {
        const _origin = new cls(...args);
        if (_origin instanceof BasicTool) {
          _origin.updateOptions(options);
        } else {
          _origin._version = BasicTool._version;
        }
        return _origin;
      }
    });
  }
  function _importESModule(path) {
    if (typeof ChromeUtils.import === "undefined") {
      return ChromeUtils.importESModule(path, { global: "contextual" });
    }
    if (path.endsWith(".sys.mjs")) {
      path = path.replace(/\.sys\.mjs$/, ".jsm");
    }
    return ChromeUtils.import(path);
  }

  // node_modules/zotero-plugin-toolkit/dist/helpers/clipboard.js
  var ClipboardHelper = class extends BasicTool {
    transferable;
    clipboardService;
    filePath = "";
    constructor() {
      super();
      this.transferable = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
      this.clipboardService = Components.classes["@mozilla.org/widget/clipboard;1"].getService(Components.interfaces.nsIClipboard);
      this.transferable.init(null);
    }
    addText(source, type = "text/plain") {
      const str = Components.classes["@mozilla.org/supports-string;1"].createInstance(Components.interfaces.nsISupportsString);
      str.data = source;
      if (type === "text/unicode")
        type = "text/plain";
      this.transferable.addDataFlavor(type);
      this.transferable.setTransferData(type, str, source.length * 2);
      return this;
    }
    addImage(source) {
      const parts = source.split(",");
      if (!parts[0].includes("base64")) {
        return this;
      }
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = this.getGlobal("window").atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const imgTools = Components.classes["@mozilla.org/image/tools;1"].getService(Components.interfaces.imgITools);
      let mimeType;
      let img;
      if (this.getGlobal("Zotero").platformMajorVersion >= 102) {
        img = imgTools.decodeImageFromArrayBuffer(u8arr.buffer, mime);
        mimeType = "application/x-moz-nativeimage";
      } else {
        mimeType = `image/png`;
        img = Components.classes["@mozilla.org/supports-interface-pointer;1"].createInstance(Components.interfaces.nsISupportsInterfacePointer);
        img.data = imgTools.decodeImageFromArrayBuffer(u8arr.buffer, mimeType);
      }
      this.transferable.addDataFlavor(mimeType);
      this.transferable.setTransferData(mimeType, img, 0);
      return this;
    }
    addFile(path) {
      const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      file.initWithPath(path);
      this.transferable.addDataFlavor("application/x-moz-file");
      this.transferable.setTransferData("application/x-moz-file", file);
      this.filePath = path;
      return this;
    }
    copy() {
      try {
        this.clipboardService.setData(this.transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard);
      } catch (e) {
        if (this.filePath && Zotero.isMac) {
          Zotero.Utilities.Internal.exec(`/usr/bin/osascript`, [
            `-e`,
            `set the clipboard to POSIX file "${this.filePath}"`
          ]);
        } else {
          throw e;
        }
      }
      return this;
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/tools/ui.js
  var UITool = class extends BasicTool {
    get basicOptions() {
      return this._basicOptions;
    }
    /**
     * Store elements created with this instance
     *
     * @remarks
     * > What is this for?
     *
     * In bootstrap plugins, elements must be manually maintained and removed on exiting.
     *
     * This API does this for you.
     */
    elementCache;
    constructor(base) {
      super(base);
      this.elementCache = [];
      if (!this._basicOptions.ui) {
        this._basicOptions.ui = {
          enableElementRecord: true,
          enableElementJSONLog: false,
          enableElementDOMLog: true
        };
      }
    }
    /**
     * Remove all elements created by `createElement`.
     *
     * @remarks
     * > What is this for?
     *
     * In bootstrap plugins, elements must be manually maintained and removed on exiting.
     *
     * This API does this for you.
     */
    unregisterAll() {
      this.elementCache.forEach((e) => {
        try {
          e?.deref()?.remove();
        } catch (e2) {
          this.log(e2);
        }
      });
    }
    createElement(...args) {
      const doc = args[0];
      const tagName = args[1].toLowerCase();
      let props = args[2] || {};
      if (!tagName) {
        return;
      }
      if (typeof args[2] === "string") {
        props = {
          namespace: args[2],
          enableElementRecord: args[3]
        };
      }
      if (typeof props.enableElementJSONLog !== "undefined" && props.enableElementJSONLog || this.basicOptions.ui.enableElementJSONLog) {
        this.log(props);
      }
      props.properties = props.properties || props.directAttributes;
      props.children = props.children || props.subElementOptions;
      let elem;
      if (tagName === "fragment") {
        const fragElem = doc.createDocumentFragment();
        elem = fragElem;
      } else {
        let realElem = props.id && (props.checkExistenceParent ? props.checkExistenceParent : doc).querySelector(`#${props.id}`);
        if (realElem && props.ignoreIfExists) {
          return realElem;
        }
        if (realElem && props.removeIfExists) {
          realElem.remove();
          realElem = void 0;
        }
        if (props.customCheck && !props.customCheck(doc, props)) {
          return void 0;
        }
        if (!realElem || !props.skipIfExists) {
          let namespace = props.namespace;
          if (!namespace) {
            const mightHTML = HTMLElementTagNames.includes(tagName);
            const mightXUL = XULElementTagNames.includes(tagName);
            const mightSVG = SVGElementTagNames.includes(tagName);
            if (Number(mightHTML) + Number(mightXUL) + Number(mightSVG) > 1) {
              this.log(`[Warning] Creating element ${tagName} with no namespace specified. Found multiply namespace matches.`);
            }
            if (mightHTML) {
              namespace = "html";
            } else if (mightXUL) {
              namespace = "xul";
            } else if (mightSVG) {
              namespace = "svg";
            } else {
              namespace = "html";
            }
          }
          if (namespace === "xul") {
            realElem = this.createXULElement(doc, tagName);
          } else {
            realElem = doc.createElementNS({
              html: "http://www.w3.org/1999/xhtml",
              svg: "http://www.w3.org/2000/svg"
            }[namespace], tagName);
          }
          if (typeof props.enableElementRecord !== "undefined" ? props.enableElementRecord : this.basicOptions.ui.enableElementRecord) {
            this.elementCache.push(new WeakRef(realElem));
          }
        }
        if (props.id) {
          realElem.id = props.id;
        }
        if (props.styles && Object.keys(props.styles).length) {
          Object.keys(props.styles).forEach((k) => {
            const v = props.styles[k];
            typeof v !== "undefined" && (realElem.style[k] = v);
          });
        }
        if (props.properties && Object.keys(props.properties).length) {
          Object.keys(props.properties).forEach((k) => {
            const v = props.properties[k];
            typeof v !== "undefined" && (realElem[k] = v);
          });
        }
        if (props.attributes && Object.keys(props.attributes).length) {
          Object.keys(props.attributes).forEach((k) => {
            const v = props.attributes[k];
            typeof v !== "undefined" && realElem.setAttribute(k, String(v));
          });
        }
        if (props.classList?.length) {
          realElem.classList.add(...props.classList);
        }
        if (props.listeners?.length) {
          props.listeners.forEach(({ type, listener, options }) => {
            listener && realElem.addEventListener(type, listener, options);
          });
        }
        elem = realElem;
      }
      if (props.children?.length) {
        const subElements = props.children.map((childProps) => {
          childProps.namespace = childProps.namespace || props.namespace;
          return this.createElement(doc, childProps.tag, childProps);
        }).filter((e) => e);
        elem.append(...subElements);
      }
      if (typeof props.enableElementDOMLog !== "undefined" ? props.enableElementDOMLog : this.basicOptions.ui.enableElementDOMLog) {
        this.log(elem);
      }
      return elem;
    }
    /**
     * Append element(s) to a node.
     * @param properties See {@link ElementProps}
     * @param container The parent node to append to.
     * @returns A Node that is the appended child (aChild),
     *          except when aChild is a DocumentFragment,
     *          in which case the empty DocumentFragment is returned.
     */
    appendElement(properties, container) {
      return container.appendChild(this.createElement(container.ownerDocument, properties.tag, properties));
    }
    /**
     * Inserts a node before a reference node as a child of its parent node.
     * @param properties See {@link ElementProps}
     * @param referenceNode The node before which newNode is inserted.
     * @returns Node
     */
    insertElementBefore(properties, referenceNode) {
      if (referenceNode.parentNode)
        return referenceNode.parentNode.insertBefore(this.createElement(referenceNode.ownerDocument, properties.tag, properties), referenceNode);
      else
        this.log(`${referenceNode.tagName} has no parent, cannot insert ${properties.tag}`);
    }
    /**
     * Replace oldNode with a new one.
     * @param properties See {@link ElementProps}
     * @param oldNode The child to be replaced.
     * @returns The replaced Node. This is the same node as oldChild.
     */
    replaceElement(properties, oldNode) {
      if (oldNode.parentNode)
        return oldNode.parentNode.replaceChild(this.createElement(oldNode.ownerDocument, properties.tag, properties), oldNode);
      else
        this.log(`${oldNode.tagName} has no parent, cannot replace it with ${properties.tag}`);
    }
    /**
     * Parse XHTML to XUL fragment. For Zotero 6.
     *
     * To load preferences from a Zotero 7's `.xhtml`, use this method to parse it.
     * @param str xhtml raw text
     * @param entities dtd file list ("chrome://xxx.dtd")
     * @param defaultXUL true for default XUL namespace
     */
    parseXHTMLToFragment(str, entities = [], defaultXUL = true) {
      const parser = new DOMParser();
      const xulns = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
      const htmlns = "http://www.w3.org/1999/xhtml";
      const wrappedStr = `${entities.length ? `<!DOCTYPE bindings [ ${entities.reduce((preamble, url, index) => {
        return `${preamble}<!ENTITY % _dtd-${index} SYSTEM "${url}"> %_dtd-${index}; `;
      }, "")}]>` : ""}
      <html:div xmlns="${defaultXUL ? xulns : htmlns}"
          xmlns:xul="${xulns}" xmlns:html="${htmlns}">
      ${str}
      </html:div>`;
      this.log(wrappedStr, parser);
      const doc = parser.parseFromString(wrappedStr, "text/xml");
      this.log(doc);
      if (doc.documentElement.localName === "parsererror") {
        throw new Error("not well-formed XHTML");
      }
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("div"));
      return range.extractContents();
    }
  };
  var HTMLElementTagNames = [
    "a",
    "abbr",
    "address",
    "area",
    "article",
    "aside",
    "audio",
    "b",
    "base",
    "bdi",
    "bdo",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "cite",
    "code",
    "col",
    "colgroup",
    "data",
    "datalist",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "div",
    "dl",
    "dt",
    "em",
    "embed",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "i",
    "iframe",
    "img",
    "input",
    "ins",
    "kbd",
    "label",
    "legend",
    "li",
    "link",
    "main",
    "map",
    "mark",
    "menu",
    "meta",
    "meter",
    "nav",
    "noscript",
    "object",
    "ol",
    "optgroup",
    "option",
    "output",
    "p",
    "picture",
    "pre",
    "progress",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "script",
    "section",
    "select",
    "slot",
    "small",
    "source",
    "span",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "template",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "time",
    "title",
    "tr",
    "track",
    "u",
    "ul",
    "var",
    "video",
    "wbr"
  ];
  var XULElementTagNames = [
    "action",
    "arrowscrollbox",
    "bbox",
    "binding",
    "bindings",
    "box",
    "broadcaster",
    "broadcasterset",
    "button",
    "browser",
    "checkbox",
    "caption",
    "colorpicker",
    "column",
    "columns",
    "commandset",
    "command",
    "conditions",
    "content",
    "deck",
    "description",
    "dialog",
    "dialogheader",
    "editor",
    "grid",
    "grippy",
    "groupbox",
    "hbox",
    "iframe",
    "image",
    "key",
    "keyset",
    "label",
    "listbox",
    "listcell",
    "listcol",
    "listcols",
    "listhead",
    "listheader",
    "listitem",
    "member",
    "menu",
    "menubar",
    "menuitem",
    "menulist",
    "menupopup",
    "menuseparator",
    "observes",
    "overlay",
    "page",
    "popup",
    "popupset",
    "preference",
    "preferences",
    "prefpane",
    "prefwindow",
    "progressmeter",
    "radio",
    "radiogroup",
    "resizer",
    "richlistbox",
    "richlistitem",
    "row",
    "rows",
    "rule",
    "script",
    "scrollbar",
    "scrollbox",
    "scrollcorner",
    "separator",
    "spacer",
    "splitter",
    "stack",
    "statusbar",
    "statusbarpanel",
    "stringbundle",
    "stringbundleset",
    "tab",
    "tabbrowser",
    "tabbox",
    "tabpanel",
    "tabpanels",
    "tabs",
    "template",
    "textnode",
    "textbox",
    "titlebar",
    "toolbar",
    "toolbarbutton",
    "toolbargrippy",
    "toolbaritem",
    "toolbarpalette",
    "toolbarseparator",
    "toolbarset",
    "toolbarspacer",
    "toolbarspring",
    "toolbox",
    "tooltip",
    "tree",
    "treecell",
    "treechildren",
    "treecol",
    "treecols",
    "treeitem",
    "treerow",
    "treeseparator",
    "triple",
    "vbox",
    "window",
    "wizard",
    "wizardpage"
  ];
  var SVGElementTagNames = [
    "a",
    "animate",
    "animateMotion",
    "animateTransform",
    "circle",
    "clipPath",
    "defs",
    "desc",
    "ellipse",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "filter",
    "foreignObject",
    "g",
    "image",
    "line",
    "linearGradient",
    "marker",
    "mask",
    "metadata",
    "mpath",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "script",
    "set",
    "stop",
    "style",
    "svg",
    "switch",
    "symbol",
    "text",
    "textPath",
    "title",
    "tspan",
    "use",
    "view"
  ];

  // node_modules/zotero-plugin-toolkit/dist/helpers/dialog.js
  var DialogHelper = class extends UITool {
    /**
     * Passed to dialog window for data-binding and lifecycle controls. See {@link DialogHelper.setDialogData}
     */
    dialogData;
    /**
     * Dialog window instance
     */
    window;
    elementProps;
    /**
     * Create a dialog helper with row \* column grids.
     * @param row
     * @param column
     */
    constructor(row, column) {
      super();
      if (row <= 0 || column <= 0) {
        throw new Error(`row and column must be positive integers.`);
      }
      this.elementProps = {
        tag: "vbox",
        attributes: { flex: 1 },
        styles: {
          width: "100%",
          height: "100%"
        },
        children: []
      };
      for (let i = 0; i < Math.max(row, 1); i++) {
        this.elementProps.children.push({
          tag: "hbox",
          attributes: { flex: 1 },
          children: []
        });
        for (let j = 0; j < Math.max(column, 1); j++) {
          this.elementProps.children[i].children.push({
            tag: "vbox",
            attributes: { flex: 1 },
            children: []
          });
        }
      }
      this.elementProps.children.push({
        tag: "hbox",
        attributes: { flex: 0, pack: "end" },
        children: []
      });
      this.dialogData = {};
    }
    /**
     * Add a cell at (row, column). Index starts from 0.
     * @param row
     * @param column
     * @param elementProps Cell element props. See {@link ElementProps}
     * @param cellFlex If the cell is flex. Default true.
     */
    addCell(row, column, elementProps, cellFlex = true) {
      if (row >= this.elementProps.children.length || column >= this.elementProps.children[row].children.length) {
        throw new Error(`Cell index (${row}, ${column}) is invalid, maximum (${this.elementProps.children.length}, ${this.elementProps.children[0].children.length})`);
      }
      this.elementProps.children[row].children[column].children = [
        elementProps
      ];
      this.elementProps.children[row].children[column].attributes.flex = cellFlex ? 1 : 0;
      return this;
    }
    /**
     * Add a control button to the bottom of the dialog.
     * @param label Button label
     * @param id Button id.
     * The corresponding id of the last button user clicks before window exit will be set to `dialogData._lastButtonId`.
     * @param options Options
     * @param [options.noClose] Don't close window when clicking this button.
     * @param [options.callback] Callback of button click event.
     */
    addButton(label, id, options = {}) {
      id = id || `btn-${Zotero.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`;
      this.elementProps.children[this.elementProps.children.length - 1].children.push({
        tag: "vbox",
        styles: {
          margin: "10px"
        },
        children: [
          {
            tag: "button",
            namespace: "html",
            id,
            attributes: {
              type: "button",
              "data-l10n-id": label
            },
            properties: {
              innerHTML: label
            },
            listeners: [
              {
                type: "click",
                listener: (e) => {
                  this.dialogData._lastButtonId = id;
                  if (options.callback) {
                    options.callback(e);
                  }
                  if (!options.noClose) {
                    this.window.close();
                  }
                }
              }
            ]
          }
        ]
      });
      return this;
    }
    /**
     * Dialog data.
     * @remarks
     * This object is passed to the dialog window.
     *
     * The control button id is in `dialogData._lastButtonId`;
     *
     * The data-binding values are in `dialogData`.
     * ```ts
     * interface DialogData {
     *   [key: string | number | symbol]: any;
     *   loadLock?: { promise: Promise<void>; resolve: () => void; isResolved: () => boolean }; // resolve after window load (auto-generated)
     *   loadCallback?: Function; // called after window load
     *   unloadLock?: { promise: Promise<void>; resolve: () => void }; // resolve after window unload (auto-generated)
     *   unloadCallback?: Function; // called after window unload
     *   beforeUnloadCallback?: Function; // called before window unload when elements are accessable.
     * }
     * ```
     * @param dialogData
     */
    setDialogData(dialogData) {
      this.dialogData = dialogData;
      return this;
    }
    /**
     * Open the dialog
     * @param title Window title
     * @param windowFeatures
     * @param windowFeatures.width Ignored if fitContent is `true`.
     * @param windowFeatures.height Ignored if fitContent is `true`.
     * @param windowFeatures.left
     * @param windowFeatures.top
     * @param windowFeatures.centerscreen Open window at the center of screen.
     * @param windowFeatures.resizable If window is resizable.
     * @param windowFeatures.fitContent Resize the window to content size after elements are loaded.
     * @param windowFeatures.noDialogMode Dialog mode window only has a close button. Set `true` to make maximize and minimize button visible.
     * @param windowFeatures.alwaysRaised Is the window always at the top.
     */
    open(title, windowFeatures = {
      centerscreen: true,
      resizable: true,
      fitContent: true
    }) {
      this.window = openDialog(this, `dialog-${Zotero.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`, title, this.elementProps, this.dialogData, windowFeatures);
      return this;
    }
  };
  function openDialog(dialogHelper, targetId, title, elementProps, dialogData, windowFeatures = {
    centerscreen: true,
    resizable: true,
    fitContent: true
  }) {
    dialogData = dialogData || {};
    if (!dialogData.loadLock) {
      let loadResolve;
      let isLoadResolved = false;
      const loadPromise = new Promise((resolve) => {
        loadResolve = resolve;
      });
      loadPromise.then(() => {
        isLoadResolved = true;
      });
      dialogData.loadLock = {
        promise: loadPromise,
        resolve: loadResolve,
        isResolved: () => isLoadResolved
      };
    }
    if (!dialogData.unloadLock) {
      let unloadResolve;
      const unloadPromise = new Promise((resolve) => {
        unloadResolve = resolve;
      });
      dialogData.unloadLock = {
        promise: unloadPromise,
        resolve: unloadResolve
      };
    }
    let featureString = `resizable=${windowFeatures.resizable ? "yes" : "no"},`;
    if (windowFeatures.width || windowFeatures.height) {
      featureString += `width=${windowFeatures.width || 100},height=${windowFeatures.height || 100},`;
    }
    if (windowFeatures.left) {
      featureString += `left=${windowFeatures.left},`;
    }
    if (windowFeatures.top) {
      featureString += `top=${windowFeatures.top},`;
    }
    if (windowFeatures.centerscreen) {
      featureString += "centerscreen,";
    }
    if (windowFeatures.noDialogMode) {
      featureString += "dialog=no,";
    }
    if (windowFeatures.alwaysRaised) {
      featureString += "alwaysRaised=yes,";
    }
    const win = dialogHelper.getGlobal("openDialog")("about:blank", targetId || "_blank", featureString, dialogData);
    dialogData.loadLock?.promise.then(() => {
      win.document.head.appendChild(dialogHelper.createElement(win.document, "title", {
        properties: { innerText: title },
        attributes: { "data-l10n-id": title }
      }));
      let l10nFiles = dialogData.l10nFiles || [];
      if (typeof l10nFiles === "string") {
        l10nFiles = [l10nFiles];
      }
      l10nFiles.forEach((file) => {
        win.document.head.appendChild(dialogHelper.createElement(win.document, "link", {
          properties: {
            rel: "localization",
            href: file
          }
        }));
      });
      dialogHelper.appendElement({
        tag: "fragment",
        children: [
          {
            tag: "style",
            properties: {
              // eslint-disable-next-line ts/no-use-before-define
              innerHTML: style
            }
          },
          {
            tag: "link",
            properties: {
              rel: "stylesheet",
              href: "chrome://zotero-platform/content/zotero.css"
            }
          }
        ]
      }, win.document.head);
      replaceElement(elementProps, dialogHelper);
      win.document.body.appendChild(dialogHelper.createElement(win.document, "fragment", {
        children: [elementProps]
      }));
      Array.from(win.document.querySelectorAll("*[data-bind]")).forEach((elem) => {
        const bindKey = elem.getAttribute("data-bind");
        const bindAttr = elem.getAttribute("data-attr");
        const bindProp = elem.getAttribute("data-prop");
        if (bindKey && dialogData && dialogData[bindKey]) {
          if (bindProp) {
            elem[bindProp] = dialogData[bindKey];
          } else {
            elem.setAttribute(bindAttr || "value", dialogData[bindKey]);
          }
        }
      });
      if (windowFeatures.fitContent) {
        setTimeout(() => {
          win.sizeToContent();
        }, 300);
      }
      win.focus();
    }).then(() => {
      dialogData?.loadCallback && dialogData.loadCallback();
    });
    dialogData.unloadLock?.promise.then(() => {
      dialogData?.unloadCallback && dialogData.unloadCallback();
    });
    win.addEventListener("DOMContentLoaded", function onWindowLoad(_ev) {
      win.arguments[0]?.loadLock?.resolve();
      win.removeEventListener("DOMContentLoaded", onWindowLoad, false);
    }, false);
    win.addEventListener("beforeunload", function onWindowBeforeUnload(_ev) {
      Array.from(win.document.querySelectorAll("*[data-bind]")).forEach((elem) => {
        const dialogData2 = this.window.arguments[0];
        const bindKey = elem.getAttribute("data-bind");
        const bindAttr = elem.getAttribute("data-attr");
        const bindProp = elem.getAttribute("data-prop");
        if (bindKey && dialogData2) {
          if (bindProp) {
            dialogData2[bindKey] = elem[bindProp];
          } else {
            dialogData2[bindKey] = elem.getAttribute(bindAttr || "value");
          }
        }
      });
      this.window.removeEventListener("beforeunload", onWindowBeforeUnload, false);
      dialogData?.beforeUnloadCallback && dialogData.beforeUnloadCallback();
    });
    win.addEventListener("unload", function onWindowUnload(_ev) {
      if (!this.window.arguments[0]?.loadLock?.isResolved()) {
        return;
      }
      this.window.arguments[0]?.unloadLock?.resolve();
      this.window.removeEventListener("unload", onWindowUnload, false);
    });
    if (win.document.readyState === "complete") {
      win.arguments[0]?.loadLock?.resolve();
    }
    return win;
  }
  function replaceElement(elementProps, uiTool) {
    let checkChildren = true;
    if (elementProps.tag === "select") {
      checkChildren = false;
      const customSelectProps = {
        tag: "div",
        classList: ["dropdown"],
        listeners: [
          {
            type: "mouseleave",
            listener: (ev) => {
              const select = ev.target.querySelector("select");
              select?.blur();
            }
          }
        ],
        children: [
          Object.assign({}, elementProps, {
            tag: "select",
            listeners: [
              {
                type: "focus",
                listener: (ev) => {
                  const select = ev.target;
                  const dropdown = select.parentElement?.querySelector(".dropdown-content");
                  dropdown && (dropdown.style.display = "block");
                  select.setAttribute("focus", "true");
                }
              },
              {
                type: "blur",
                listener: (ev) => {
                  const select = ev.target;
                  const dropdown = select.parentElement?.querySelector(".dropdown-content");
                  dropdown && (dropdown.style.display = "none");
                  select.removeAttribute("focus");
                }
              }
            ]
          }),
          {
            tag: "div",
            classList: ["dropdown-content"],
            children: elementProps.children?.map((option) => ({
              tag: "p",
              attributes: {
                value: option.properties?.value
              },
              properties: {
                innerHTML: option.properties?.innerHTML || option.properties?.textContent
              },
              classList: ["dropdown-item"],
              listeners: [
                {
                  type: "click",
                  listener: (ev) => {
                    const select = ev.target.parentElement?.previousElementSibling;
                    select && (select.value = ev.target.getAttribute("value") || "");
                    select?.blur();
                  }
                }
              ]
            }))
          }
        ]
      };
      for (const key in elementProps) {
        delete elementProps[key];
      }
      Object.assign(elementProps, customSelectProps);
    } else if (elementProps.tag === "a") {
      const href = elementProps?.properties?.href || "";
      elementProps.properties ??= {};
      elementProps.properties.href = "javascript:void(0);";
      elementProps.attributes ??= {};
      elementProps.attributes["zotero-href"] = href;
      elementProps.listeners ??= [];
      elementProps.listeners.push({
        type: "click",
        listener: (ev) => {
          const href2 = ev.target?.getAttribute("zotero-href");
          href2 && uiTool.getGlobal("Zotero").launchURL(href2);
        }
      });
      elementProps.classList ??= [];
      elementProps.classList.push("zotero-text-link");
    }
    if (checkChildren) {
      elementProps.children?.forEach((child) => replaceElement(child, uiTool));
    }
  }
  var style = `
html {
  color-scheme: light dark;
}
.zotero-text-link {
  -moz-user-focus: normal;
  color: -moz-nativehyperlinktext;
  text-decoration: underline;
  border: 1px solid transparent;
  cursor: pointer;
}
.dropdown {
  position: relative;
  display: inline-block;
}
.dropdown-content {
  display: none;
  position: absolute;
  background-color: var(--material-toolbar);
  min-width: 160px;
  box-shadow: 0px 0px 5px 0px rgba(0, 0, 0, 0.5);
  border-radius: 5px;
  padding: 5px 0 5px 0;
  z-index: 999;
}
.dropdown-item {
  margin: 0px;
  padding: 5px 10px 5px 10px;
}
.dropdown-item:hover {
  background-color: var(--fill-quinary);
}
`;

  // node_modules/zotero-plugin-toolkit/dist/helpers/filePicker.js
  var FilePickerHelper = class extends BasicTool {
    title;
    mode;
    filters;
    suggestion;
    directory;
    window;
    filterMask;
    constructor(title, mode, filters, suggestion, window2, filterMask, directory) {
      super();
      this.title = title;
      this.mode = mode;
      this.filters = filters;
      this.suggestion = suggestion;
      this.directory = directory;
      this.window = window2;
      this.filterMask = filterMask;
    }
    async open() {
      const Backend = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs").FilePicker;
      const fp = new Backend();
      fp.init(this.window || this.getGlobal("window"), this.title, this.getMode(fp));
      for (const [label, ext] of this.filters || []) {
        fp.appendFilter(label, ext);
      }
      if (this.filterMask)
        fp.appendFilters(this.getFilterMask(fp));
      if (this.suggestion)
        fp.defaultString = this.suggestion;
      if (this.directory)
        fp.displayDirectory = this.directory;
      const userChoice = await fp.show();
      switch (userChoice) {
        case fp.returnOK:
        case fp.returnReplace:
          return this.mode === "multiple" ? fp.files : fp.file;
        default:
          return false;
      }
    }
    getMode(fp) {
      switch (this.mode) {
        case "open":
          return fp.modeOpen;
        case "save":
          return fp.modeSave;
        case "folder":
          return fp.modeGetFolder;
        case "multiple":
          return fp.modeOpenMultiple;
        default:
          return 0;
      }
    }
    getFilterMask(fp) {
      switch (this.filterMask) {
        case "all":
          return fp.filterAll;
        case "html":
          return fp.filterHTML;
        case "text":
          return fp.filterText;
        case "images":
          return fp.filterImages;
        case "xml":
          return fp.filterXML;
        case "apps":
          return fp.filterApps;
        case "urls":
          return fp.filterAllowURLs;
        case "audio":
          return fp.filterAudio;
        case "video":
          return fp.filterVideo;
        default:
          return 1;
      }
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/helpers/guide.js
  var GuideHelper = class extends BasicTool {
    _steps = [];
    constructor() {
      super();
    }
    addStep(step) {
      this._steps.push(step);
      return this;
    }
    addSteps(steps) {
      this._steps.push(...steps);
      return this;
    }
    async show(doc) {
      if (!doc?.ownerGlobal) {
        throw new Error("Document is required.");
      }
      const guide = new Guide(doc.ownerGlobal);
      await guide.show(this._steps);
      const promise = new Promise((resolve) => {
        guide._panel.addEventListener("guide-finished", () => resolve(guide));
      });
      await promise;
      return guide;
    }
    async highlight(doc, step) {
      if (!doc?.ownerGlobal) {
        throw new Error("Document is required.");
      }
      const guide = new Guide(doc.ownerGlobal);
      await guide.show([step]);
      const promise = new Promise((resolve) => {
        guide._panel.addEventListener("guide-finished", () => resolve(guide));
      });
      await promise;
      return guide;
    }
  };
  var Guide = class {
    _window;
    _id = `guide-${Zotero.Utilities.randomString()}`;
    _panel;
    _header;
    _body;
    _footer;
    _progress;
    _closeButton;
    _prevButton;
    _nextButton;
    _steps;
    _noClose;
    _closed;
    _autoNext;
    _currentIndex;
    initialized;
    _cachedMasks = [];
    get content() {
      return this._window.MozXULElement.parseXULToFragment(`
      <panel id="${this._id}" class="guide-panel" type="arrow" align="top" noautohide="true">
          <html:div class="guide-panel-content">
              <html:div class="guide-panel-header"></html:div>
              <html:div class="guide-panel-body"></html:div>
              <html:div class="guide-panel-footer">
                  <html:div class="guide-panel-progress"></html:div>
                  <html:div class="guide-panel-buttons">
                      <button id="prev-button" class="guide-panel-button" hidden="true"></button>
                      <button id="next-button" class="guide-panel-button" hidden="true"></button>
                      <button id="close-button" class="guide-panel-button" hidden="true"></button>
                  </html:div>
              </html:div>
          </html:div>
          <html:style>
              .guide-panel {
                  background-color: var(--material-menu);
                  color: var(--fill-primary);
              }
              .guide-panel-content {
                  display: flex;
                  flex-direction: column;
                  padding: 0;
              }
              .guide-panel-header {
                  font-size: 1.2em;
                  font-weight: bold;
                  margin-bottom: 10px;
              }
              .guide-panel-header:empty {
                display: none;
              }
              .guide-panel-body {
                  align-items: center;
                  display: flex;
                  flex-direction: column;
                  white-space: pre-wrap;
              }
              .guide-panel-body:empty {
                display: none;
              }
              .guide-panel-footer {
                  display: flex;
                  flex-direction: row;
                  align-items: center;
                  justify-content: space-between;
                  margin-top: 10px;
              }
              .guide-panel-progress {
                  font-size: 0.8em;
              }
              .guide-panel-buttons {
                  display: flex;
                  flex-direction: row;
                  flex-grow: 1;
                  justify-content: flex-end;
              }
          </html:style>
      </panel>
  `);
    }
    get currentStep() {
      if (!this._steps)
        return void 0;
      return this._steps[this._currentIndex];
    }
    get currentTarget() {
      const step = this.currentStep;
      if (!step?.element)
        return void 0;
      let elem;
      if (typeof step.element === "function") {
        elem = step.element();
      } else if (typeof step.element === "string") {
        elem = this._window.document.querySelector(step.element);
      } else if (!step.element) {
        elem = this._window.document.documentElement || void 0;
      } else {
        elem = step.element;
      }
      return elem;
    }
    get hasNext() {
      return this._steps && this._currentIndex < this._steps.length - 1;
    }
    get hasPrevious() {
      return this._steps && this._currentIndex > 0;
    }
    get hookProps() {
      return {
        config: this.currentStep,
        state: {
          step: this._currentIndex,
          steps: this._steps,
          controller: this
        }
      };
    }
    get panel() {
      return this._panel;
    }
    constructor(win) {
      this._window = win;
      this._noClose = false;
      this._closed = false;
      this._autoNext = true;
      this._currentIndex = 0;
      const doc = win.document;
      const content = this.content;
      if (content) {
        doc.documentElement?.append(doc.importNode(content, true));
      }
      this._panel = doc.querySelector(`#${this._id}`);
      this._header = this._panel.querySelector(".guide-panel-header");
      this._body = this._panel.querySelector(".guide-panel-body");
      this._footer = this._panel.querySelector(".guide-panel-footer");
      this._progress = this._panel.querySelector(".guide-panel-progress");
      this._closeButton = this._panel.querySelector("#close-button");
      this._prevButton = this._panel.querySelector("#prev-button");
      this._nextButton = this._panel.querySelector("#next-button");
      this._closeButton.addEventListener("click", async () => {
        if (this.currentStep?.onCloseClick) {
          await this.currentStep.onCloseClick(this.hookProps);
        }
        this.abort();
      });
      this._prevButton.addEventListener("click", async () => {
        if (this.currentStep?.onPrevClick) {
          await this.currentStep.onPrevClick(this.hookProps);
        }
        this.movePrevious();
      });
      this._nextButton.addEventListener("click", async () => {
        if (this.currentStep?.onNextClick) {
          await this.currentStep.onNextClick(this.hookProps);
        }
        this.moveNext();
      });
      this._panel.addEventListener("popupshown", this._handleShown.bind(this));
      this._panel.addEventListener("popuphidden", this._handleHidden.bind(this));
      this._window.addEventListener("resize", this._centerPanel);
    }
    async show(steps) {
      if (steps) {
        this._steps = steps;
        this._currentIndex = 0;
      }
      const index = this._currentIndex;
      this._noClose = false;
      this._closed = false;
      this._autoNext = true;
      const step = this.currentStep;
      if (!step)
        return;
      const elem = this.currentTarget;
      if (step.onBeforeRender) {
        await step.onBeforeRender(this.hookProps);
        if (index !== this._currentIndex) {
          await this.show();
          return;
        }
      }
      if (step.onMask) {
        step.onMask({ mask: (_e) => this._createMask(_e) });
      } else {
        this._createMask(elem);
      }
      let x;
      let y = 0;
      let position = step.position || "after_start";
      if (position === "center") {
        position = "overlap";
        x = this._window.innerWidth / 2;
        y = this._window.innerHeight / 2;
      }
      this._panel.openPopup(elem, step.position || "after_start", x, y, false, false);
    }
    hide() {
      this._panel.hidePopup();
    }
    abort() {
      this._closed = true;
      this.hide();
      this._steps = void 0;
    }
    moveTo(stepIndex) {
      if (!this._steps) {
        this.hide();
        return;
      }
      if (stepIndex < 0)
        stepIndex = 0;
      if (!this._steps[stepIndex]) {
        this._currentIndex = this._steps.length;
        this.hide();
        return;
      }
      this._autoNext = false;
      this._noClose = true;
      this.hide();
      this._noClose = false;
      this._autoNext = true;
      this._currentIndex = stepIndex;
      this.show();
    }
    moveNext() {
      this.moveTo(this._currentIndex + 1);
    }
    movePrevious() {
      this.moveTo(this._currentIndex - 1);
    }
    _handleShown() {
      if (!this._steps)
        return;
      const step = this.currentStep;
      if (!step)
        return;
      this._header.innerHTML = step.title || "";
      this._body.innerHTML = step.description || "";
      this._panel.querySelectorAll(".guide-panel-button").forEach((elem) => {
        elem.hidden = true;
        elem.disabled = false;
      });
      let showButtons = step.showButtons;
      if (!showButtons) {
        showButtons = [];
        if (this.hasPrevious) {
          showButtons.push("prev");
        }
        if (this.hasNext) {
          showButtons.push("next");
        } else {
          showButtons.push("close");
        }
      }
      if (showButtons?.length) {
        showButtons.forEach((btn) => {
          this._panel.querySelector(`#${btn}-button`).hidden = false;
        });
      }
      if (step.disableButtons) {
        step.disableButtons.forEach((btn) => {
          this._panel.querySelector(`#${btn}-button`).disabled = true;
        });
      }
      if (step.showProgress) {
        this._progress.hidden = false;
        this._progress.textContent = step.progressText || `${this._currentIndex + 1}/${this._steps.length}`;
      } else {
        this._progress.hidden = true;
      }
      this._closeButton.label = step.closeBtnText || "Done";
      this._nextButton.label = step.nextBtnText || "Next";
      this._prevButton.label = step.prevBtnText || "Previous";
      if (step.onRender) {
        step.onRender(this.hookProps);
      }
      if (step.position === "center") {
        this._centerPanel();
        this._window.setTimeout(this._centerPanel, 10);
      }
    }
    async _handleHidden() {
      this._removeMask();
      this._header.innerHTML = "";
      this._body.innerHTML = "";
      this._progress.textContent = "";
      if (!this._steps)
        return;
      const step = this.currentStep;
      if (step && step.onExit) {
        await step.onExit(this.hookProps);
      }
      if (!this._noClose && (this._closed || !this.hasNext)) {
        this._panel.dispatchEvent(new this._window.CustomEvent("guide-finished"));
        this._panel.remove();
        this._window.removeEventListener("resize", this._centerPanel);
        return;
      }
      if (this._autoNext) {
        this.moveNext();
      }
    }
    _centerPanel = () => {
      const win = this._window;
      this._panel.moveTo(win.screenX + win.innerWidth / 2 - this._panel.clientWidth / 2, win.screenY + win.innerHeight / 2 - this._panel.clientHeight / 2);
    };
    _createMask(targetElement) {
      const doc = targetElement?.ownerDocument || this._window.document;
      const NS = "http://www.w3.org/2000/svg";
      const svg = doc.createElementNS(NS, "svg");
      svg.id = "guide-panel-mask";
      svg.style.position = "fixed";
      svg.style.top = "0";
      svg.style.left = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.zIndex = "9999";
      const mask = doc.createElementNS(NS, "mask");
      mask.id = "mask";
      const fullRect = doc.createElementNS(NS, "rect");
      fullRect.setAttribute("x", "0");
      fullRect.setAttribute("y", "0");
      fullRect.setAttribute("width", "100%");
      fullRect.setAttribute("height", "100%");
      fullRect.setAttribute("fill", "white");
      mask.appendChild(fullRect);
      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        const targetRect = doc.createElementNS(NS, "rect");
        targetRect.setAttribute("x", rect.left.toString());
        targetRect.setAttribute("y", rect.top.toString());
        targetRect.setAttribute("width", rect.width.toString());
        targetRect.setAttribute("height", rect.height.toString());
        targetRect.setAttribute("fill", "black");
        mask.appendChild(targetRect);
      }
      const maskedRect = doc.createElementNS(NS, "rect");
      maskedRect.setAttribute("x", "0");
      maskedRect.setAttribute("y", "0");
      maskedRect.setAttribute("width", "100%");
      maskedRect.setAttribute("height", "100%");
      maskedRect.setAttribute("mask", "url(#mask)");
      maskedRect.setAttribute("opacity", "0.7");
      svg.appendChild(mask);
      svg.appendChild(maskedRect);
      this._cachedMasks.push(new WeakRef(svg));
      doc.documentElement?.appendChild(svg);
    }
    _removeMask() {
      this._cachedMasks.forEach((ref) => {
        const mask = ref.deref();
        if (mask) {
          mask.remove();
        }
      });
      this._cachedMasks = [];
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/helpers/largePref.js
  var LargePrefHelper = class extends BasicTool {
    keyPref;
    valuePrefPrefix;
    innerObj;
    hooks;
    /**
     *
     * @param keyPref The preference name for storing the keys of the data.
     * @param valuePrefPrefix The preference name prefix for storing the values of the data.
     * @param hooks Hooks for parsing the values of the data.
     * - `afterGetValue`: A function that takes the value of the data as input and returns the parsed value.
     * - `beforeSetValue`: A function that takes the key and value of the data as input and returns the parsed key and value.
     * If `hooks` is `"default"`, no parsing will be done.
     * If `hooks` is `"parser"`, the values will be parsed as JSON.
     * If `hooks` is an object, the values will be parsed by the hooks.
     */
    constructor(keyPref, valuePrefPrefix, hooks = "default") {
      super();
      this.keyPref = keyPref;
      this.valuePrefPrefix = valuePrefPrefix;
      if (hooks === "default") {
        this.hooks = defaultHooks;
      } else if (hooks === "parser") {
        this.hooks = parserHooks;
      } else {
        this.hooks = { ...defaultHooks, ...hooks };
      }
      this.innerObj = {};
    }
    /**
     * Get the object that stores the data.
     * @returns The object that stores the data.
     */
    asObject() {
      return this.constructTempObj();
    }
    /**
     * Get the Map that stores the data.
     * @returns The Map that stores the data.
     */
    asMapLike() {
      const mapLike = {
        get: (key) => this.getValue(key),
        set: (key, value) => {
          this.setValue(key, value);
          return mapLike;
        },
        has: (key) => this.hasKey(key),
        delete: (key) => this.deleteKey(key),
        clear: () => {
          for (const key of this.getKeys()) {
            this.deleteKey(key);
          }
        },
        forEach: (callback) => {
          return this.constructTempMap().forEach(callback);
        },
        get size() {
          return this._this.getKeys().length;
        },
        entries: () => {
          return this.constructTempMap().values();
        },
        keys: () => {
          const keys = this.getKeys();
          return keys[Symbol.iterator]();
        },
        values: () => {
          return this.constructTempMap().values();
        },
        [Symbol.iterator]: () => {
          return this.constructTempMap()[Symbol.iterator]();
        },
        [Symbol.toStringTag]: "MapLike",
        _this: this
      };
      return mapLike;
    }
    /**
     * Get the keys of the data.
     * @returns The keys of the data.
     */
    getKeys() {
      const rawKeys = Zotero.Prefs.get(this.keyPref, true);
      const keys = rawKeys ? JSON.parse(rawKeys) : [];
      for (const key of keys) {
        const value = "placeholder";
        this.innerObj[key] = value;
      }
      return keys;
    }
    /**
     * Set the keys of the data.
     * @param keys The keys of the data.
     */
    setKeys(keys) {
      keys = [...new Set(keys.filter((key) => key))];
      Zotero.Prefs.set(this.keyPref, JSON.stringify(keys), true);
      for (const key of keys) {
        const value = "placeholder";
        this.innerObj[key] = value;
      }
    }
    /**
     * Get the value of a key.
     * @param key The key of the data.
     * @returns The value of the key.
     */
    getValue(key) {
      const value = Zotero.Prefs.get(`${this.valuePrefPrefix}${key}`, true);
      if (typeof value === "undefined") {
        return;
      }
      const { value: newValue } = this.hooks.afterGetValue({ value });
      this.innerObj[key] = newValue;
      return newValue;
    }
    /**
     * Set the value of a key.
     * @param key The key of the data.
     * @param value The value of the key.
     */
    setValue(key, value) {
      const { key: newKey, value: newValue } = this.hooks.beforeSetValue({
        key,
        value
      });
      this.setKey(newKey);
      Zotero.Prefs.set(`${this.valuePrefPrefix}${newKey}`, newValue, true);
      this.innerObj[newKey] = newValue;
    }
    /**
     * Check if a key exists.
     * @param key The key of the data.
     * @returns Whether the key exists.
     */
    hasKey(key) {
      return this.getKeys().includes(key);
    }
    /**
     * Add a key.
     * @param key The key of the data.
     */
    setKey(key) {
      const keys = this.getKeys();
      if (!keys.includes(key)) {
        keys.push(key);
        this.setKeys(keys);
      }
    }
    /**
     * Delete a key.
     * @param key The key of the data.
     */
    deleteKey(key) {
      const keys = this.getKeys();
      const index = keys.indexOf(key);
      if (index > -1) {
        keys.splice(index, 1);
        delete this.innerObj[key];
        this.setKeys(keys);
      }
      Zotero.Prefs.clear(`${this.valuePrefPrefix}${key}`, true);
      return true;
    }
    constructTempObj() {
      return new Proxy(this.innerObj, {
        get: (target, prop, receiver) => {
          this.getKeys();
          if (typeof prop === "string" && prop in target) {
            this.getValue(prop);
          }
          return Reflect.get(target, prop, receiver);
        },
        set: (target, p, newValue, receiver) => {
          if (typeof p === "string") {
            if (newValue === void 0) {
              this.deleteKey(p);
              return true;
            }
            this.setValue(p, newValue);
            return true;
          }
          return Reflect.set(target, p, newValue, receiver);
        },
        has: (target, p) => {
          this.getKeys();
          return Reflect.has(target, p);
        },
        deleteProperty: (target, p) => {
          if (typeof p === "string") {
            this.deleteKey(p);
            return true;
          }
          return Reflect.deleteProperty(target, p);
        }
      });
    }
    constructTempMap() {
      const map = /* @__PURE__ */ new Map();
      for (const key of this.getKeys()) {
        map.set(key, this.getValue(key));
      }
      return map;
    }
  };
  var defaultHooks = {
    afterGetValue: ({ value }) => ({ value }),
    beforeSetValue: ({ key, value }) => ({ key, value })
  };
  var parserHooks = {
    afterGetValue: ({ value }) => {
      try {
        value = JSON.parse(value);
      } catch {
        return { value };
      }
      return { value };
    },
    beforeSetValue: ({ key, value }) => {
      value = JSON.stringify(value);
      return { key, value };
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/helpers/patch.js
  var PatchHelper = class extends BasicTool {
    options;
    constructor() {
      super();
      this.options = void 0;
    }
    setData(options) {
      this.options = options;
      const Zotero2 = this.getGlobal("Zotero");
      const { target, funcSign, patcher } = options;
      const origin = target[funcSign];
      this.log("patching ", funcSign);
      target[funcSign] = function(...args) {
        if (options.enabled)
          try {
            return patcher(origin).apply(this, args);
          } catch (e) {
            Zotero2.logError(e);
          }
        return origin.apply(this, args);
      };
      return this;
    }
    enable() {
      if (!this.options)
        throw new Error("No patch data set");
      this.options.enabled = true;
      return this;
    }
    disable() {
      if (!this.options)
        throw new Error("No patch data set");
      this.options.enabled = false;
      return this;
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/helpers/progressWindow.js
  var icons = {
    success: "chrome://zotero/skin/tick.png",
    fail: "chrome://zotero/skin/cross.png"
  };
  var ProgressWindowHelper = class {
    win;
    lines;
    closeTime;
    /**
     *
     * @param header window header
     * @param options
     * @param options.window
     * @param options.closeOnClick
     * @param options.closeTime
     * @param options.closeOtherProgressWindows
     */
    constructor(header, options = {
      closeOnClick: true,
      closeTime: 5e3
    }) {
      this.win = new (BasicTool.getZotero()).ProgressWindow(options);
      this.lines = [];
      this.closeTime = options.closeTime || 5e3;
      this.win.changeHeadline(header);
      if (options.closeOtherProgressWindows) {
        BasicTool.getZotero().ProgressWindowSet.closeAll();
      }
    }
    /**
     * Create a new line
     * @param options
     * @param options.type
     * @param options.icon
     * @param options.text
     * @param options.progress
     * @param options.idx
     */
    createLine(options) {
      const icon = this.getIcon(options.type, options.icon);
      const line = new this.win.ItemProgress(icon || "", options.text || "");
      if (typeof options.progress === "number") {
        line.setProgress(options.progress);
      }
      this.lines.push(line);
      this.updateIcons();
      return this;
    }
    /**
     * Change the line content
     * @param options
     * @param options.type
     * @param options.icon
     * @param options.text
     * @param options.progress
     * @param options.idx
     */
    changeLine(options) {
      if (this.lines?.length === 0) {
        return this;
      }
      const idx = typeof options.idx !== "undefined" && options.idx >= 0 && options.idx < this.lines.length ? options.idx : 0;
      const icon = this.getIcon(options.type, options.icon);
      if (icon) {
        this.lines[idx].setItemTypeAndIcon(icon);
      }
      options.text && this.lines[idx].setText(options.text);
      typeof options.progress === "number" && this.lines[idx].setProgress(options.progress);
      this.updateIcons();
      return this;
    }
    show(closeTime = void 0) {
      this.win.show();
      typeof closeTime !== "undefined" && (this.closeTime = closeTime);
      if (this.closeTime && this.closeTime > 0) {
        this.win.startCloseTimer(this.closeTime);
      }
      setTimeout(this.updateIcons.bind(this), 50);
      return this;
    }
    /**
     * Set custom icon uri for progress window
     * @param key
     * @param uri
     */
    static setIconURI(key, uri) {
      icons[key] = uri;
    }
    getIcon(type, defaultIcon) {
      return type && type in icons ? icons[type] : defaultIcon;
    }
    updateIcons() {
      try {
        this.lines.forEach((line) => {
          const box = line._image;
          const icon = box.dataset.itemType;
          if (icon && !box.style.backgroundImage.includes("progress_arcs")) {
            box.style.backgroundImage = `url(${box.dataset.itemType})`;
          }
        });
      } catch {
      }
    }
    changeHeadline(text, icon, postText) {
      this.win.changeHeadline(text, icon, postText);
      return this;
    }
    addLines(labels, icons2) {
      this.win.addLines(labels, icons2);
      return this;
    }
    addDescription(text) {
      this.win.addDescription(text);
      return this;
    }
    startCloseTimer(ms, requireMouseOver) {
      this.win.startCloseTimer(ms, requireMouseOver);
      return this;
    }
    close() {
      this.win.close();
      return this;
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/helpers/virtualizedTable.js
  var VirtualizedTableHelper = class extends BasicTool {
    props;
    localeStrings;
    containerId;
    treeInstance;
    window;
    React;
    ReactDOM;
    VirtualizedTable;
    IntlProvider;
    constructor(win) {
      super();
      this.window = win;
      const Zotero2 = this.getGlobal("Zotero");
      const _require = win.require;
      this.React = _require("react");
      this.ReactDOM = _require("react-dom");
      this.VirtualizedTable = _require("components/virtualized-table");
      this.IntlProvider = _require("react-intl").IntlProvider;
      this.props = {
        id: `vtable-${Zotero2.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`,
        getRowCount: () => 0
      };
      this.localeStrings = Zotero2.Intl.strings;
    }
    setProp(...args) {
      if (args.length === 1) {
        Object.assign(this.props, args[0]);
      } else if (args.length === 2) {
        this.props[args[0]] = args[1];
      }
      return this;
    }
    /**
     * Set locale strings, which replaces the table header's label if matches. Default it's `Zotero.Intl.strings`
     * @param localeStrings
     */
    setLocale(localeStrings) {
      Object.assign(this.localeStrings, localeStrings);
      return this;
    }
    /**
     * Set container element id that the table will be rendered on.
     * @param id element id
     */
    setContainerId(id) {
      this.containerId = id;
      return this;
    }
    /**
     * Render the table.
     * @param selectId Which row to select after rendering
     * @param onfulfilled callback after successfully rendered
     * @param onrejected callback after rendering with error
     */
    render(selectId, onfulfilled, onrejected) {
      const refreshSelection = () => {
        this.treeInstance.invalidate();
        if (typeof selectId !== "undefined" && selectId >= 0) {
          this.treeInstance.selection.select(selectId);
        } else {
          this.treeInstance.selection.clearSelection();
        }
      };
      if (!this.treeInstance) {
        new Promise((resolve) => {
          const vtableProps = Object.assign({}, this.props, {
            ref: (ref) => {
              this.treeInstance = ref;
              resolve(void 0);
            }
          });
          if (vtableProps.getRowData && !vtableProps.renderItem) {
            Object.assign(vtableProps, {
              renderItem: this.VirtualizedTable.makeRowRenderer(vtableProps.getRowData)
            });
          }
          const elem = this.React.createElement(this.IntlProvider, { locale: Zotero.locale, messages: Zotero.Intl.strings }, this.React.createElement(this.VirtualizedTable, vtableProps));
          const container = this.window.document.getElementById(this.containerId);
          this.ReactDOM.createRoot(container).render(elem);
        }).then(() => {
          this.getGlobal("setTimeout")(() => {
            refreshSelection();
          });
        }).then(onfulfilled, onrejected);
      } else {
        refreshSelection();
      }
      return this;
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/managers/fieldHook.js
  var FieldHookManager = class extends ManagerTool {
    data = {
      getField: {},
      setField: {},
      isFieldOfBase: {}
    };
    patchHelpers = {
      getField: new PatchHelper(),
      setField: new PatchHelper(),
      isFieldOfBase: new PatchHelper()
    };
    constructor(base) {
      super(base);
      const _thisHelper = this;
      for (const type of Object.keys(this.patchHelpers)) {
        const helper = this.patchHelpers[type];
        helper.setData({
          target: this.getGlobal("Zotero").Item.prototype,
          funcSign: type,
          patcher: (original) => function(field, ...args) {
            const originalThis = this;
            const handler = _thisHelper.data[type][field];
            if (typeof handler === "function") {
              try {
                return handler(field, args[0], args[1], originalThis, original);
              } catch (e) {
                return field + String(e);
              }
            }
            return original.apply(originalThis, [field, ...args]);
          },
          enabled: true
        });
      }
    }
    register(type, field, hook) {
      this.data[type][field] = hook;
    }
    unregister(type, field) {
      delete this.data[type][field];
    }
    unregisterAll() {
      this.data.getField = {};
      this.data.setField = {};
      this.data.isFieldOfBase = {};
      this.patchHelpers.getField.disable();
      this.patchHelpers.setField.disable();
      this.patchHelpers.isFieldOfBase.disable();
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/utils/wait.js
  var basicTool = new BasicTool();
  function waitUntil(condition, callback, interval = 100, timeout = 1e4) {
    const start = Date.now();
    const intervalId = basicTool.getGlobal("setInterval")(() => {
      if (condition()) {
        basicTool.getGlobal("clearInterval")(intervalId);
        callback();
      } else if (Date.now() - start > timeout) {
        basicTool.getGlobal("clearInterval")(intervalId);
      }
    }, interval);
  }
  var waitUtilAsync = waitUntilAsync;
  function waitUntilAsync(condition, interval = 100, timeout = 1e4) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const intervalId = basicTool.getGlobal("setInterval")(() => {
        if (condition()) {
          basicTool.getGlobal("clearInterval")(intervalId);
          resolve();
        } else if (Date.now() - start > timeout) {
          basicTool.getGlobal("clearInterval")(intervalId);
          reject(new Error("timeout"));
        }
      }, interval);
    });
  }
  async function waitForReader(reader) {
    await reader._initPromise;
    await reader._lastView.initializedPromise;
    if (reader.type === "pdf")
      await reader._lastView._iframeWindow.PDFViewerApplication.initializedPromise;
  }

  // node_modules/zotero-plugin-toolkit/dist/managers/keyboard.js
  var KeyboardManager = class extends ManagerTool {
    _keyboardCallbacks = /* @__PURE__ */ new Set();
    _cachedKey;
    id;
    constructor(base) {
      super(base);
      this.id = `kbd-${Zotero.Utilities.randomString()}`;
      this._ensureAutoUnregisterAll();
      this.addListenerCallback("onMainWindowLoad", this.initKeyboardListener);
      this.addListenerCallback("onMainWindowUnload", this.unInitKeyboardListener);
      this.initReaderKeyboardListener();
      for (const win of Zotero.getMainWindows()) {
        this.initKeyboardListener(win);
      }
    }
    /**
     * Register a keyboard event listener.
     * @param callback The callback function.
     */
    register(callback) {
      this._keyboardCallbacks.add(callback);
    }
    /**
     * Unregister a keyboard event listener.
     * @param callback The callback function.
     */
    unregister(callback) {
      this._keyboardCallbacks.delete(callback);
    }
    /**
     * Unregister all keyboard event listeners.
     */
    unregisterAll() {
      this._keyboardCallbacks.clear();
      this.removeListenerCallback("onMainWindowLoad", this.initKeyboardListener);
      this.removeListenerCallback("onMainWindowUnload", this.unInitKeyboardListener);
      for (const win of Zotero.getMainWindows()) {
        this.unInitKeyboardListener(win);
      }
    }
    initKeyboardListener = this._initKeyboardListener.bind(this);
    unInitKeyboardListener = this._unInitKeyboardListener.bind(this);
    initReaderKeyboardListener() {
      Zotero.Reader.registerEventListener("renderToolbar", (event) => this.addReaderKeyboardCallback(event), this._basicOptions.api.pluginID);
      Zotero.Reader._readers.forEach((reader) => this.addReaderKeyboardCallback({ reader }));
    }
    async addReaderKeyboardCallback(event) {
      const reader = event.reader;
      const initializedKey = `_ztoolkitKeyboard${this.id}Initialized`;
      await waitForReader(reader);
      if (!reader._iframeWindow) {
        return;
      }
      if (reader._iframeWindow[initializedKey]) {
        return;
      }
      this._initKeyboardListener(reader._iframeWindow);
      waitUntil(() => !Components.utils.isDeadWrapper(reader._internalReader) && reader._internalReader?._primaryView?._iframeWindow, () => this._initKeyboardListener(reader._internalReader._primaryView?._iframeWindow));
      reader._iframeWindow[initializedKey] = true;
    }
    _initKeyboardListener(win) {
      if (!win) {
        return;
      }
      win.addEventListener("keydown", this.triggerKeydown);
      win.addEventListener("keyup", this.triggerKeyup);
    }
    _unInitKeyboardListener(win) {
      if (!win) {
        return;
      }
      win.removeEventListener("keydown", this.triggerKeydown);
      win.removeEventListener("keyup", this.triggerKeyup);
    }
    triggerKeydown = (e) => {
      if (!this._cachedKey) {
        this._cachedKey = new KeyModifier(e);
      } else {
        this._cachedKey.merge(new KeyModifier(e), { allowOverwrite: false });
      }
      this.dispatchCallback(e, {
        type: "keydown"
      });
    };
    triggerKeyup = async (e) => {
      if (!this._cachedKey) {
        return;
      }
      const currentShortcut = new KeyModifier(this._cachedKey);
      this._cachedKey = void 0;
      this.dispatchCallback(e, {
        keyboard: currentShortcut,
        type: "keyup"
      });
    };
    dispatchCallback(...args) {
      this._keyboardCallbacks.forEach((cbk) => cbk(...args));
    }
  };
  var KeyModifier = class {
    accel = false;
    shift = false;
    control = false;
    meta = false;
    alt = false;
    key = "";
    useAccel = false;
    constructor(raw, options) {
      this.useAccel = options?.useAccel || false;
      if (typeof raw === "undefined") {
      } else if (typeof raw === "string") {
        raw = raw || "";
        raw = this.unLocalized(raw);
        this.accel = raw.includes("accel");
        this.shift = raw.includes("shift");
        this.control = raw.includes("control");
        this.meta = raw.includes("meta");
        this.alt = raw.includes("alt");
        this.key = raw.replace(/(accel|shift|control|meta|alt|[ ,\-])/g, "").toLocaleLowerCase();
      } else if (raw instanceof KeyModifier) {
        this.merge(raw, { allowOverwrite: true });
      } else {
        if (options?.useAccel) {
          if (Zotero.isMac) {
            this.accel = raw.metaKey;
          } else {
            this.accel = raw.ctrlKey;
          }
        }
        this.shift = raw.shiftKey;
        this.control = raw.ctrlKey;
        this.meta = raw.metaKey;
        this.alt = raw.altKey;
        if (!["Shift", "Meta", "Ctrl", "Alt", "Control"].includes(raw.key)) {
          this.key = raw.key;
        }
      }
    }
    /**
     * Merge another KeyModifier into this one.
     * @param newMod the new KeyModifier
     * @param options
     * @param options.allowOverwrite
     * @returns KeyModifier
     */
    merge(newMod, options) {
      const allowOverwrite = options?.allowOverwrite || false;
      this.mergeAttribute("accel", newMod.accel, allowOverwrite);
      this.mergeAttribute("shift", newMod.shift, allowOverwrite);
      this.mergeAttribute("control", newMod.control, allowOverwrite);
      this.mergeAttribute("meta", newMod.meta, allowOverwrite);
      this.mergeAttribute("alt", newMod.alt, allowOverwrite);
      this.mergeAttribute("key", newMod.key, allowOverwrite);
      return this;
    }
    /**
     * Check if the current KeyModifier equals to another KeyModifier.
     * @param newMod the new KeyModifier
     * @returns true if equals
     */
    equals(newMod) {
      if (typeof newMod === "string") {
        newMod = new KeyModifier(newMod);
      }
      if (this.shift !== newMod.shift || this.alt !== newMod.alt || this.key.toLowerCase() !== newMod.key.toLowerCase()) {
        return false;
      }
      if (this.accel || newMod.accel) {
        if (Zotero.isMac) {
          if ((this.accel || this.meta) !== (newMod.accel || newMod.meta) || this.control !== newMod.control) {
            return false;
          }
        } else {
          if ((this.accel || this.control) !== (newMod.accel || newMod.control) || this.meta !== newMod.meta) {
            return false;
          }
        }
      } else {
        if (this.control !== newMod.control || this.meta !== newMod.meta) {
          return false;
        }
      }
      return true;
    }
    /**
     * Get the raw string representation of the KeyModifier.
     */
    getRaw() {
      const enabled = [];
      this.accel && enabled.push("accel");
      this.shift && enabled.push("shift");
      this.control && enabled.push("control");
      this.meta && enabled.push("meta");
      this.alt && enabled.push("alt");
      this.key && enabled.push(this.key);
      return enabled.join(",");
    }
    /**
     * Get the localized string representation of the KeyModifier.
     */
    getLocalized() {
      const raw = this.getRaw();
      if (Zotero.isMac) {
        return raw.replaceAll("control", "\u2303").replaceAll("alt", "\u2325").replaceAll("shift", "\u21E7").replaceAll("meta", "\u2318");
      } else {
        return raw.replaceAll("control", "Ctrl").replaceAll("alt", "Alt").replaceAll("shift", "Shift").replaceAll("meta", "Win");
      }
    }
    /**
     * Get the un-localized string representation of the KeyModifier.
     */
    unLocalized(raw) {
      if (Zotero.isMac) {
        return raw.replaceAll("\u2303", "control").replaceAll("\u2325", "alt").replaceAll("\u21E7", "shift").replaceAll("\u2318", "meta");
      } else {
        return raw.replaceAll("Ctrl", "control").replaceAll("Alt", "alt").replaceAll("Shift", "shift").replaceAll("Win", "meta");
      }
    }
    mergeAttribute(attribute, value, allowOverwrite) {
      if (allowOverwrite || !this[attribute]) {
        this[attribute] = value;
      }
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/managers/menu.js
  var MenuManager = class extends ManagerTool {
    ui;
    constructor(base) {
      super(base);
      this.ui = new UITool(this);
    }
    /**
     * Insert an menu item/menu(with popup)/menuseprator into a menupopup
     * @remarks
     * options:
     * ```ts
     * export interface MenuitemOptions {
     *   tag: "menuitem" | "menu" | "menuseparator";
     *   id?: string;
     *   label?: string;
     *   // data url (chrome://xxx.png) or base64 url (data:image/png;base64,xxx)
     *   icon?: string;
     *   class?: string;
     *   styles?: { [key: string]: string };
     *   hidden?: boolean;
     *   disabled?: boolean;
     *   oncommand?: string;
     *   commandListener?: EventListenerOrEventListenerObject;
     *   // Attributes below are used when type === "menu"
     *   popupId?: string;
     *   onpopupshowing?: string;
     *   subElementOptions?: Array<MenuitemOptions>;
     * }
     * ```
     * @param menuPopup
     * @param options
     * @param insertPosition
     * @param anchorElement The menuitem will be put before/after `anchorElement`. If not set, put at start/end of the menupopup.
     * @example
     * Insert menuitem with icon into item menupopup
     * ```ts
     * // base64 or chrome:// url
     * const menuIcon = "chrome://addontemplate/content/icons/favicon@0.5x.png";
     * ztoolkit.Menu.register("item", {
     *   tag: "menuitem",
     *   id: "zotero-itemmenu-addontemplate-test",
     *   label: "Addon Template: Menuitem",
     *   oncommand: "alert('Hello World! Default Menuitem.')",
     *   icon: menuIcon,
     * });
     * ```
     * @example
     * Insert menu into file menupopup
     * ```ts
     * ztoolkit.Menu.register(
     *   "menuFile",
     *   {
     *     tag: "menu",
     *     label: "Addon Template: Menupopup",
     *     subElementOptions: [
     *       {
     *         tag: "menuitem",
     *         label: "Addon Template",
     *         oncommand: "alert('Hello World! Sub Menuitem.')",
     *       },
     *     ],
     *   },
     *   "before",
     *   Zotero.getMainWindow().document.querySelector(
     *     "#zotero-itemmenu-addontemplate-test"
     *   )
     * );
     * ```
     */
    register(menuPopup, options, insertPosition = "after", anchorElement) {
      let popup;
      if (typeof menuPopup === "string") {
        popup = this.getGlobal("document").querySelector(MenuSelector[menuPopup]);
      } else {
        popup = menuPopup;
      }
      if (!popup) {
        return false;
      }
      const doc = popup.ownerDocument;
      const genMenuElement = (menuitemOption) => {
        const elementOption = {
          tag: menuitemOption.tag,
          id: menuitemOption.id,
          namespace: "xul",
          attributes: {
            label: menuitemOption.label || "",
            hidden: Boolean(menuitemOption.hidden),
            disabled: Boolean(menuitemOption.disabled),
            class: menuitemOption.class || "",
            oncommand: menuitemOption.oncommand || ""
          },
          classList: menuitemOption.classList,
          styles: menuitemOption.styles || {},
          listeners: [],
          children: []
        };
        if (menuitemOption.icon) {
          if (!this.getGlobal("Zotero").isMac) {
            if (menuitemOption.tag === "menu") {
              elementOption.attributes.class += " menu-iconic";
            } else {
              elementOption.attributes.class += " menuitem-iconic";
            }
          }
          elementOption.styles["list-style-image"] = `url(${menuitemOption.icon})`;
        }
        if (menuitemOption.commandListener) {
          elementOption.listeners?.push({
            type: "command",
            listener: menuitemOption.commandListener
          });
        }
        if (menuitemOption.tag === "menuitem") {
          elementOption.attributes.type = menuitemOption.type || "";
          elementOption.attributes.checked = menuitemOption.checked || false;
        }
        const menuItem = this.ui.createElement(doc, menuitemOption.tag, elementOption);
        if (menuitemOption.isHidden || menuitemOption.getVisibility) {
          popup?.addEventListener("popupshowing", (ev) => {
            let hidden;
            if (menuitemOption.isHidden) {
              hidden = menuitemOption.isHidden(menuItem, ev);
            } else if (menuitemOption.getVisibility) {
              const visible = menuitemOption.getVisibility(menuItem, ev);
              hidden = typeof visible === "undefined" ? void 0 : !visible;
            }
            if (typeof hidden === "undefined") {
              return;
            }
            if (hidden) {
              menuItem.setAttribute("hidden", "true");
            } else {
              menuItem.removeAttribute("hidden");
            }
          });
        }
        if (menuitemOption.isDisabled) {
          popup?.addEventListener("popupshowing", (ev) => {
            const disabled = menuitemOption.isDisabled(menuItem, ev);
            if (typeof disabled === "undefined") {
              return;
            }
            if (disabled) {
              menuItem.setAttribute("disabled", "true");
            } else {
              menuItem.removeAttribute("disabled");
            }
          });
        }
        if ((menuitemOption.tag === "menuitem" || menuitemOption.tag === "menuseparator") && menuitemOption.onShowing) {
          popup?.addEventListener("popupshowing", (ev) => {
            menuitemOption.onShowing(menuItem, ev);
          });
        }
        if (menuitemOption.tag === "menu") {
          const subPopup = this.ui.createElement(doc, "menupopup", {
            id: menuitemOption.popupId,
            attributes: { onpopupshowing: menuitemOption.onpopupshowing || "" }
          });
          menuitemOption.children?.forEach((childOption) => {
            subPopup.append(genMenuElement(childOption));
          });
          menuItem.append(subPopup);
        }
        return menuItem;
      };
      const topMenuItem = genMenuElement(options);
      if (popup.childElementCount) {
        if (!anchorElement) {
          anchorElement = insertPosition === "after" ? popup.lastElementChild : popup.firstElementChild;
        }
        anchorElement[insertPosition](topMenuItem);
      } else {
        popup.appendChild(topMenuItem);
      }
    }
    unregister(menuId) {
      this.getGlobal("document").querySelector(`#${menuId}`)?.remove();
    }
    unregisterAll() {
      this.ui.unregisterAll();
    }
  };
  var MenuSelector;
  (function(MenuSelector2) {
    MenuSelector2["menuFile"] = "#menu_FilePopup";
    MenuSelector2["menuEdit"] = "#menu_EditPopup";
    MenuSelector2["menuView"] = "#menu_viewPopup";
    MenuSelector2["menuGo"] = "#menu_goPopup";
    MenuSelector2["menuTools"] = "#menu_ToolsPopup";
    MenuSelector2["menuHelp"] = "#menu_HelpPopup";
    MenuSelector2["collection"] = "#zotero-collectionmenu";
    MenuSelector2["item"] = "#zotero-itemmenu";
  })(MenuSelector || (MenuSelector = {}));

  // node_modules/zotero-plugin-toolkit/dist/managers/prompt.js
  var Prompt = class {
    ui;
    base;
    get document() {
      return this.base.getGlobal("document");
    }
    /**
     * Record the last text entered
     */
    lastInputText = "";
    /**
     * Default text
     */
    defaultText = {
      placeholder: "Select a command...",
      empty: "No commands found."
    };
    /**
     * It controls the max line number of commands displayed in `commandsNode`.
     */
    maxLineNum = 12;
    /**
     * It controls the max number of suggestions.
     */
    maxSuggestionNum = 100;
    /**
     * The top-level HTML div node of `Prompt`
     */
    promptNode;
    /**
     * The HTML input node of `Prompt`.
     */
    inputNode;
    /**
     * Save all commands registered by all addons.
     */
    commands = [];
    /**
     * Initialize `Prompt` but do not create UI.
     */
    constructor() {
      this.base = new BasicTool();
      this.ui = new UITool();
      this.initializeUI();
    }
    /**
     * Initialize `Prompt` UI and then bind events on it.
     */
    initializeUI() {
      this.addStyle();
      this.createHTML();
      this.initInputEvents();
      this.registerShortcut();
    }
    createHTML() {
      this.promptNode = this.ui.createElement(this.document, "div", {
        styles: {
          display: "none"
        },
        children: [
          {
            tag: "div",
            styles: {
              position: "fixed",
              left: "0",
              top: "0",
              backgroundColor: "transparent",
              width: "100%",
              height: "100%"
            },
            listeners: [
              {
                type: "click",
                listener: () => {
                  this.promptNode.style.display = "none";
                }
              }
            ]
          }
        ]
      });
      this.promptNode.appendChild(this.ui.createElement(this.document, "div", {
        id: `zotero-plugin-toolkit-prompt`,
        classList: ["prompt-container"],
        children: [
          {
            tag: "div",
            classList: ["input-container"],
            children: [
              {
                tag: "input",
                classList: ["prompt-input"],
                attributes: {
                  type: "text",
                  placeholder: this.defaultText.placeholder
                }
              },
              {
                tag: "div",
                classList: ["cta"]
              }
            ]
          },
          {
            tag: "div",
            classList: ["commands-containers"]
          },
          {
            tag: "div",
            classList: ["instructions"],
            children: [
              {
                tag: "div",
                classList: ["instruction"],
                children: [
                  {
                    tag: "span",
                    classList: ["key"],
                    properties: {
                      innerText: "\u2191\u2193"
                    }
                  },
                  {
                    tag: "span",
                    properties: {
                      innerText: "to navigate"
                    }
                  }
                ]
              },
              {
                tag: "div",
                classList: ["instruction"],
                children: [
                  {
                    tag: "span",
                    classList: ["key"],
                    properties: {
                      innerText: "enter"
                    }
                  },
                  {
                    tag: "span",
                    properties: {
                      innerText: "to trigger"
                    }
                  }
                ]
              },
              {
                tag: "div",
                classList: ["instruction"],
                children: [
                  {
                    tag: "span",
                    classList: ["key"],
                    properties: {
                      innerText: "esc"
                    }
                  },
                  {
                    tag: "span",
                    properties: {
                      innerText: "to exit"
                    }
                  }
                ]
              }
            ]
          }
        ]
      }));
      this.inputNode = this.promptNode.querySelector("input");
      this.document.documentElement.appendChild(this.promptNode);
    }
    /**
     * Show commands in a new `commandsContainer`
     * All other `commandsContainer` is hidden
     * @param commands Command[]
     * @param clear remove all `commandsContainer` if true
     */
    showCommands(commands, clear = false) {
      if (clear) {
        this.promptNode.querySelectorAll(".commands-container").forEach((e) => e.remove());
      }
      this.inputNode.placeholder = this.defaultText.placeholder;
      const commandsContainer = this.createCommandsContainer();
      for (const command of commands) {
        try {
          if (!command.name || command.when && !command.when()) {
            continue;
          }
        } catch {
          continue;
        }
        commandsContainer.appendChild(this.createCommandNode(command));
      }
    }
    /**
     * Create a `commandsContainer` div element, append to `commandsContainer` and hide others.
     * @returns commandsNode
     */
    createCommandsContainer() {
      const commandsContainer = this.ui.createElement(this.document, "div", {
        classList: ["commands-container"]
      });
      this.promptNode.querySelectorAll(".commands-container").forEach((e) => {
        e.style.display = "none";
      });
      this.promptNode.querySelector(".commands-containers").appendChild(commandsContainer);
      return commandsContainer;
    }
    /**
     * Return current displayed `commandsContainer`
     * @returns
     */
    getCommandsContainer() {
      return [
        ...Array.from(this.promptNode.querySelectorAll(".commands-container"))
      ].find((e) => {
        return e.style.display !== "none";
      });
    }
    /**
     * Create a command item for `Prompt` UI.
     * @param command
     * @returns
     */
    createCommandNode(command) {
      const commandNode = this.ui.createElement(this.document, "div", {
        classList: ["command"],
        children: [
          {
            tag: "div",
            classList: ["content"],
            children: [
              {
                tag: "div",
                classList: ["name"],
                children: [
                  {
                    tag: "span",
                    properties: {
                      innerText: command.name
                    }
                  }
                ]
              },
              {
                tag: "div",
                classList: ["aux"],
                children: command.label ? [
                  {
                    tag: "span",
                    classList: ["label"],
                    properties: {
                      innerText: command.label
                    }
                  }
                ] : []
              }
            ]
          }
        ],
        listeners: [
          {
            type: "mousemove",
            listener: () => {
              this.selectItem(commandNode);
            }
          },
          {
            type: "click",
            listener: async () => {
              await this.execCallback(command.callback);
            }
          }
        ]
      });
      commandNode.command = command;
      return commandNode;
    }
    /**
     * Called when `enter` key is pressed.
     */
    trigger() {
      [
        ...Array.from(this.promptNode.querySelectorAll(".commands-container"))
      ].find((e) => e.style.display !== "none").querySelector(".selected").click();
    }
    /**
     * Called when `escape` key is pressed.
     */
    exit() {
      this.inputNode.placeholder = this.defaultText.placeholder;
      if (this.promptNode.querySelectorAll(".commands-containers .commands-container").length >= 2) {
        this.promptNode.querySelector(".commands-container:last-child").remove();
        const commandsContainer = this.promptNode.querySelector(".commands-container:last-child");
        commandsContainer.style.display = "";
        commandsContainer.querySelectorAll(".commands").forEach((e) => e.style.display = "flex");
        this.inputNode.focus();
      } else {
        this.promptNode.style.display = "none";
      }
    }
    async execCallback(callback) {
      if (Array.isArray(callback)) {
        this.showCommands(callback);
      } else {
        await callback(this);
      }
    }
    /**
     * Match suggestions for user's entered text.
     */
    async showSuggestions(inputText) {
      const _w = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/;
      const jw = /\s/;
      const Ww = /[\u0F00-\u0FFF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F]/;
      function Yw(e2, t, n, i) {
        if (e2.length === 0)
          return 0;
        let r = 0;
        r -= Math.max(0, e2.length - 1), r -= i / 10;
        const o = e2[0][0];
        return r -= (e2[e2.length - 1][1] - o + 1 - t) / 100, r -= o / 1e3, r -= n / 1e4;
      }
      function $w(e2, t, n, i) {
        if (e2.length === 0)
          return null;
        for (var r = n.toLowerCase(), o = 0, a = 0, s = [], l = 0; l < e2.length; l++) {
          const c = e2[l];
          const u = r.indexOf(c, a);
          if (u === -1)
            return null;
          const h = n.charAt(u);
          if (u > 0 && !_w.test(h) && !Ww.test(h)) {
            const p = n.charAt(u - 1);
            if (h.toLowerCase() !== h && p.toLowerCase() !== p || h.toUpperCase() !== h && !_w.test(p) && !jw.test(p) && !Ww.test(p))
              if (i) {
                if (u !== a) {
                  a += c.length, l--;
                  continue;
                }
              } else
                o += 1;
          }
          if (s.length === 0)
            s.push([u, u + c.length]);
          else {
            const d = s[s.length - 1];
            d[1] < u ? s.push([u, u + c.length]) : d[1] = u + c.length;
          }
          a = u + c.length;
        }
        return {
          matches: s,
          score: Yw(s, t.length, r.length, o)
        };
      }
      function Gw(e2) {
        for (var t = e2.toLowerCase(), n = [], i = 0, r = 0; r < t.length; r++) {
          const o = t.charAt(r);
          jw.test(o) ? (i !== r && n.push(t.substring(i, r)), i = r + 1) : (_w.test(o) || Ww.test(o)) && (i !== r && n.push(t.substring(i, r)), n.push(o), i = r + 1);
        }
        return i !== t.length && n.push(t.substring(i, t.length)), {
          query: e2,
          tokens: n,
          fuzzy: t.split("")
        };
      }
      function Xw(e2, t) {
        if (e2.query === "")
          return {
            score: 0,
            matches: []
          };
        const n = $w(e2.tokens, e2.query, t, false);
        return n || $w(e2.fuzzy, e2.query, t, true);
      }
      const e = Gw(inputText);
      let container = this.getCommandsContainer();
      if (container.classList.contains("suggestions")) {
        this.exit();
      }
      if (inputText.trim() == "") {
        return true;
      }
      const suggestions = [];
      this.getCommandsContainer().querySelectorAll(".command").forEach((commandNode) => {
        const spanNode = commandNode.querySelector(".name span");
        const spanText = spanNode.innerText;
        const res = Xw(e, spanText);
        if (res) {
          commandNode = this.createCommandNode(commandNode.command);
          let spanHTML = "";
          let i = 0;
          for (let j = 0; j < res.matches.length; j++) {
            const [start, end] = res.matches[j];
            if (start > i) {
              spanHTML += spanText.slice(i, start);
            }
            spanHTML += `<span class="highlight">${spanText.slice(start, end)}</span>`;
            i = end;
          }
          if (i < spanText.length) {
            spanHTML += spanText.slice(i, spanText.length);
          }
          commandNode.querySelector(".name span").innerHTML = spanHTML;
          suggestions.push({ score: res.score, commandNode });
        }
      });
      if (suggestions.length > 0) {
        suggestions.sort((a, b) => b.score - a.score).slice(this.maxSuggestionNum);
        container = this.createCommandsContainer();
        container.classList.add("suggestions");
        suggestions.forEach((suggestion) => {
          container.appendChild(suggestion.commandNode);
        });
        return true;
      } else {
        const anonymousCommand = this.commands.find((c) => !c.name && (!c.when || c.when()));
        if (anonymousCommand) {
          await this.execCallback(anonymousCommand.callback);
        } else {
          this.showTip(this.defaultText.empty);
        }
        return false;
      }
    }
    /**
     * Bind events of pressing `keydown` and `keyup` key.
     */
    initInputEvents() {
      this.promptNode.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          let selectedIndex;
          const allItems = [
            ...Array.from(this.getCommandsContainer().querySelectorAll(".command"))
          ].filter((e) => e.style.display != "none");
          selectedIndex = allItems.findIndex((e) => e.classList.contains("selected"));
          if (selectedIndex != -1) {
            allItems[selectedIndex].classList.remove("selected");
            selectedIndex += event.key == "ArrowUp" ? -1 : 1;
          } else {
            if (event.key == "ArrowUp") {
              selectedIndex = allItems.length - 1;
            } else {
              selectedIndex = 0;
            }
          }
          if (selectedIndex == -1) {
            selectedIndex = allItems.length - 1;
          } else if (selectedIndex == allItems.length) {
            selectedIndex = 0;
          }
          allItems[selectedIndex].classList.add("selected");
          const commandsContainer = this.getCommandsContainer();
          commandsContainer.scrollTo(0, commandsContainer.querySelector(".selected").offsetTop - commandsContainer.offsetHeight + 7.5);
          allItems[selectedIndex].classList.add("selected");
        }
      });
      this.promptNode.addEventListener("keyup", async (event) => {
        if (event.key == "Enter") {
          this.trigger();
        } else if (event.key == "Escape") {
          if (this.inputNode.value.length > 0) {
            this.inputNode.value = "";
          } else {
            this.exit();
          }
        } else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
          return;
        }
        const currentInputText = this.inputNode.value;
        if (currentInputText == this.lastInputText) {
          return;
        }
        this.lastInputText = currentInputText;
        window.setTimeout(async () => {
          await this.showSuggestions(currentInputText);
        });
      });
    }
    /**
     * Create a commandsContainer and display a text
     */
    showTip(text) {
      const tipNode = this.ui.createElement(this.document, "div", {
        classList: ["tip"],
        properties: {
          innerText: text
        }
      });
      const container = this.createCommandsContainer();
      container.classList.add("suggestions");
      container.appendChild(tipNode);
      return tipNode;
    }
    /**
     * Mark the selected item with class `selected`.
     * @param item HTMLDivElement
     */
    selectItem(item) {
      this.getCommandsContainer().querySelectorAll(".command").forEach((e) => e.classList.remove("selected"));
      item.classList.add("selected");
    }
    addStyle() {
      const style2 = this.ui.createElement(this.document, "style", {
        namespace: "html",
        id: "prompt-style"
      });
      style2.innerText = `
      .prompt-container * {
        box-sizing: border-box;
      }
      .prompt-container {
        ---radius---: 10px;
        position: fixed;
        left: 25%;
        top: 10%;
        width: 50%;
        border-radius: var(---radius---);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-size: 18px;
        box-shadow: 0px 1.8px 7.3px rgba(0, 0, 0, 0.071),
                    0px 6.3px 24.7px rgba(0, 0, 0, 0.112),
                    0px 30px 90px rgba(0, 0, 0, 0.2);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif;
        background-color: var(--material-background) !important;
        border: var(--material-border-quarternary) !important;
      }
      
      /* input */
      .prompt-container .input-container  {
        width: 100%;
      }

      .input-container input {
        width: -moz-available;
        height: 40px;
        padding: 24px;
        border: none;
        outline: none;
        font-size: 18px;
        margin: 0 !important;
        border-radius: var(---radius---);
        background-color: var(--material-background);
      }
      
      .input-container .cta {
        border-bottom: var(--material-border-quarternary);
        margin: 5px auto;
      }
      
      /* results */
      .commands-containers {
        width: 100%;
        height: 100%;
      }
      .commands-container {
        max-height: calc(${this.maxLineNum} * 35.5px);
        width: calc(100% - 12px);
        margin-left: 12px;
        margin-right: 0%;
        overflow-y: auto;
        overflow-x: hidden;
      }
      
      .commands-container .command {
        display: flex;
        align-content: baseline;
        justify-content: space-between;
        border-radius: 5px;
        padding: 6px 12px;
        margin-right: 12px;
        margin-top: 2px;
        margin-bottom: 2px;
      }
      .commands-container .command .content {
        display: flex;
        width: 100%;
        justify-content: space-between;
        flex-direction: row;
        overflow: hidden;
      }
      .commands-container .command .content .name {
        white-space: nowrap; 
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .commands-container .command .content .aux {
        display: flex;
        align-items: center;
        align-self: center;
        flex-shrink: 0;
      }
      
      .commands-container .command .content .aux .label {
        font-size: 15px;
        color: var(--fill-primary);
        padding: 2px 6px;
        background-color: var(--color-background);
        border-radius: 5px;
      }
      
      .commands-container .selected {
          background-color: var(--material-mix-quinary);
      }

      .commands-container .highlight {
        font-weight: bold;
      }

      .tip {
        color: var(--fill-primary);
        text-align: center;
        padding: 12px 12px;
        font-size: 18px;
      }

      /* instructions */
      .instructions {
        display: flex;
        align-content: center;
        justify-content: center;
        font-size: 15px;
        height: 2.5em;
        width: 100%;
        border-top: var(--material-border-quarternary);
        color: var(--fill-secondary);
        margin-top: 5px;
      }
      
      .instructions .instruction {
        margin: auto .5em;  
      }
      
      .instructions .key {
        margin-right: .2em;
        font-weight: 600;
      }
    `;
      this.document.documentElement.appendChild(style2);
    }
    registerShortcut() {
      this.document.addEventListener("keydown", (event) => {
        if (event.shiftKey && event.key.toLowerCase() == "p") {
          if (event.originalTarget.isContentEditable || "value" in event.originalTarget || this.commands.length == 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (this.promptNode.style.display == "none") {
            this.promptNode.style.display = "flex";
            if (this.promptNode.querySelectorAll(".commands-container").length == 1) {
              this.showCommands(this.commands, true);
            }
            this.promptNode.focus();
            this.inputNode.focus();
          } else {
            this.promptNode.style.display = "none";
          }
        }
      }, true);
    }
  };
  var PromptManager = class extends ManagerTool {
    prompt;
    /**
     * Save the commands registered from this manager
     */
    commands = [];
    constructor(base) {
      super(base);
      const globalCache = toolkitGlobal_default.getInstance()?.prompt;
      if (!globalCache) {
        throw new Error("Prompt is not initialized.");
      }
      if (!globalCache._ready) {
        globalCache._ready = true;
        globalCache.instance = new Prompt();
      }
      this.prompt = globalCache.instance;
    }
    /**
     * Register commands. Don't forget to call `unregister` on plugin exit.
     * @param commands Command[]
     * @example
     * ```ts
     * let getReader = () => {
     *   return BasicTool.getZotero().Reader.getByTabID(
     *     (Zotero.getMainWindow().Zotero_Tabs).selectedID
     *   )
     * }
     *
     * register([
     *   {
     *     name: "Split Horizontally",
     *     label: "Zotero",
     *     when: () => getReader() as boolean,
     *     callback: (prompt: Prompt) => getReader().menuCmd("splitHorizontally")
     *   },
     *   {
     *     name: "Split Vertically",
     *     label: "Zotero",
     *     when: () => getReader() as boolean,
     *     callback: (prompt: Prompt) => getReader().menuCmd("splitVertically")
     *   }
     * ])
     * ```
     */
    register(commands) {
      commands.forEach((c) => c.id ??= c.name);
      this.prompt.commands = [...this.prompt.commands, ...commands];
      this.commands = [...this.commands, ...commands];
      this.prompt.showCommands(this.commands, true);
    }
    /**
     * You can delete a command registed before by its name.
     * @remarks
     * There is a premise here that the names of all commands registered by a single plugin are not duplicated.
     * @param id Command.name
     */
    unregister(id) {
      this.prompt.commands = this.prompt.commands.filter((c) => c.id != id);
      this.commands = this.commands.filter((c) => c.id != id);
    }
    /**
     * Call `unregisterAll` on plugin exit.
     */
    unregisterAll() {
      this.prompt.commands = this.prompt.commands.filter((c) => {
        return this.commands.every((_c) => _c.id != c.id);
      });
      this.commands = [];
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/tools/extraField.js
  var ExtraFieldTool = class extends BasicTool {
    /**
     * Get all extra fields
     * @param item
     */
    getExtraFields(item, backend = "custom") {
      const extraFiledRaw = item.getField("extra");
      if (backend === "default") {
        return this.getGlobal("Zotero").Utilities.Internal.extractExtraFields(extraFiledRaw).fields;
      } else {
        const map = /* @__PURE__ */ new Map();
        const nonStandardFields = [];
        extraFiledRaw.split("\n").forEach((line) => {
          const split = line.split(": ");
          if (split.length >= 2 && split[0]) {
            map.set(split[0], split.slice(1).join(": "));
          } else {
            nonStandardFields.push(line);
          }
        });
        map.set("__nonStandard__", nonStandardFields.join("\n"));
        return map;
      }
    }
    /**
     * Get extra field value by key. If it does not exists, return undefined.
     * @param item
     * @param key
     */
    getExtraField(item, key) {
      const fields = this.getExtraFields(item);
      return fields.get(key);
    }
    /**
     * Replace extra field of an item.
     * @param item
     * @param fields
     */
    async replaceExtraFields(item, fields) {
      const kvs = [];
      if (fields.has("__nonStandard__")) {
        kvs.push(fields.get("__nonStandard__"));
        fields.delete("__nonStandard__");
      }
      fields.forEach((v, k) => {
        kvs.push(`${k}: ${v}`);
      });
      item.setField("extra", kvs.join("\n"));
      await item.saveTx();
    }
    /**
     * Set an key-value pair to the item's extra field
     * @param item
     * @param key
     * @param value
     */
    async setExtraField(item, key, value) {
      const fields = this.getExtraFields(item);
      if (value === "" || typeof value === "undefined") {
        fields.delete(key);
      } else {
        fields.set(key, value);
      }
      await this.replaceExtraFields(item, fields);
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/tools/reader.js
  var ReaderTool = class extends BasicTool {
    /**
     * Get the selected tab reader.
     * @param waitTime Wait for n MS until the reader is ready
     */
    async getReader(waitTime = 5e3) {
      const Zotero_Tabs2 = this.getGlobal("Zotero_Tabs");
      if (Zotero_Tabs2.selectedType !== "reader") {
        return void 0;
      }
      let reader = Zotero.Reader.getByTabID(Zotero_Tabs2.selectedID);
      let delayCount = 0;
      const checkPeriod = 50;
      while (!reader && delayCount * checkPeriod < waitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkPeriod));
        reader = Zotero.Reader.getByTabID(Zotero_Tabs2.selectedID);
        delayCount++;
      }
      await reader?._initPromise;
      return reader;
    }
    /**
     * Get all window readers.
     */
    getWindowReader() {
      const Zotero_Tabs2 = this.getGlobal("Zotero_Tabs");
      const windowReaders = [];
      const tabs = Zotero_Tabs2._tabs.map((e) => e.id);
      for (let i = 0; i < Zotero.Reader._readers.length; i++) {
        let flag = false;
        for (let j = 0; j < tabs.length; j++) {
          if (Zotero.Reader._readers[i].tabID === tabs[j]) {
            flag = true;
            break;
          }
        }
        if (!flag) {
          windowReaders.push(Zotero.Reader._readers[i]);
        }
      }
      return windowReaders;
    }
    /**
     * Get Reader tabpanel deck element.
     * @deprecated - use item pane api
     * @alpha
     */
    getReaderTabPanelDeck() {
      const deck = this.getGlobal("window").document.querySelector(".notes-pane-deck")?.previousElementSibling;
      return deck;
    }
    /**
     * Add a reader tabpanel deck selection change observer.
     * @deprecated - use item pane api
     * @alpha
     * @param callback
     */
    async addReaderTabPanelDeckObserver(callback) {
      await waitUtilAsync(() => !!this.getReaderTabPanelDeck());
      const deck = this.getReaderTabPanelDeck();
      const observer = new (this.getGlobal("MutationObserver"))(async (mutations) => {
        mutations.forEach(async (mutation) => {
          const target = mutation.target;
          if (target.classList.contains("zotero-view-tabbox") || target.tagName === "deck") {
            callback();
          }
        });
      });
      observer.observe(deck, {
        attributes: true,
        attributeFilter: ["selectedIndex"],
        subtree: true
      });
      return observer;
    }
    /**
     * Get the selected annotation data.
     * @param reader Target reader
     * @returns The selected annotation data.
     */
    getSelectedAnnotationData(reader) {
      const annotation = (
        // @ts-expect-error _selectionPopup
        reader?._internalReader._lastView._selectionPopup?.annotation
      );
      return annotation;
    }
    /**
     * Get the text selection of reader.
     * @param reader Target reader
     * @returns The text selection of reader.
     */
    getSelectedText(reader) {
      return this.getSelectedAnnotationData(reader)?.text ?? "";
    }
  };

  // node_modules/zotero-plugin-toolkit/dist/ztoolkit.js
  var ZoteroToolkit = class extends BasicTool {
    UI = new UITool(this);
    Reader = new ReaderTool(this);
    ExtraField = new ExtraFieldTool(this);
    FieldHooks = new FieldHookManager(this);
    Keyboard = new KeyboardManager(this);
    Prompt = new PromptManager(this);
    Menu = new MenuManager(this);
    Clipboard = makeHelperTool(ClipboardHelper, this);
    FilePicker = makeHelperTool(FilePickerHelper, this);
    Patch = makeHelperTool(PatchHelper, this);
    ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
    VirtualizedTable = makeHelperTool(VirtualizedTableHelper, this);
    Dialog = makeHelperTool(DialogHelper, this);
    LargePrefObject = makeHelperTool(LargePrefHelper, this);
    Guide = makeHelperTool(GuideHelper, this);
    constructor() {
      super();
    }
    /**
     * Unregister everything created by managers.
     */
    unregisterAll() {
      unregister(this);
    }
  };
  __publicField(ZoteroToolkit, "_version", BasicTool._version);

  // package.json
  var config = {
    addonName: "PDF Figure",
    addonID: "zoterofigure@polygon.org",
    addonRef: "zoterofigure",
    addonInstance: "ZoteroFigure",
    prefsPrefix: "extensions.zotero.zoterofigure",
    releasepage: "https://github.com/MuiseDestiny/zotero-figure/releases/latest/download/zotero-figure.xpi",
    updaterdf: "https://raw.githubusercontent.com/MuiseDestiny/zotero-figure/bootstrap/update.json"
  };

  // src/modules/views.ts
  var Views = class {
    constructor() {
      this.view = "Annotation";
      this.registerButton();
      this.zoteroDir = Zotero.DataDirectory._dir;
      this.addonDir = PathUtils.join(this.zoteroDir, config.addonRef);
      this.dataDir = PathUtils.join(this.addonDir, "data");
      this.figureDir = PathUtils.join(this.addonDir, "figure");
      window.addEventListener("click", (event) => {
        if (!(event.target && event.target.baseURI == "resource://zotero/reader/reader.html" && event.target.tagName == "BUTTON" && event.target.classList.contains("tag") && event.target.innerText.match(/(Figure|Table)/))) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
        const am = reader._internalReader._annotationManager;
        this.clearFilter(reader);
        if (Zotero.BetterNotes?.hooks?.onShowImageViewer) {
          const annos = am._annotations.filter((a) => a.type == "image" && a.tags.find((t) => t.name.match(/^(Figure|Table)/)));
          const srcs = annos.map((a) => a.image);
          Zotero.BetterNotes?.hooks?.onShowImageViewer(
            srcs,
            annos.map((a) => a.tags[0].name).indexOf(event.target.innerText),
            "Figure"
          );
        }
      });
      addon.api.views = this;
      Zotero.Reader.registerEventListener("renderTextSelectionPopup", (event) => {
        const { reader } = event;
        if (this.view == "Figure") {
          this.switchToView(reader, "All");
        }
      });
    }
    async addToNote(item) {
      const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 }).createLine({ text: "Add To Note", type: "default" }).show();
      let annos = item.getAnnotations();
      annos = annos.filter((a) => a.annotationType == "image" && a.getTags()?.[0]?.tag?.match(/^(Figure|Table)/));
      await Zotero.EditorInstance.createNoteFromAnnotations(
        annos,
        // @ts-ignore
        { parentID: item.parentID }
      );
      popupWin.changeLine({ type: "success" });
      popupWin.startCloseTimer(1e3);
    }
    async getReaderInstance(itemID, focus = false) {
      let reader;
      const tab = Zotero_Tabs._tabs.find((tab2) => tab2.type == "reader" && tab2.data.itemID == itemID);
      if (tab) {
        if (tab.type == "reader-unloaded") {
          Zotero_Tabs.close(tab.id);
        } else {
          reader = Zotero.Reader.getByTabID(tab.id);
        }
      }
      reader = reader || await Zotero.Reader.open(
        itemID,
        void 0,
        { openInBackground: !focus }
      );
      if (!reader) {
        return this.getReaderInstance(itemID, focus);
      }
      while (!reader?._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfDocument) {
        await Zotero.Promise.delay(100);
      }
      return reader;
    }
    /**
     * 注册所有按钮
     */
    registerButton() {
      Zotero.Reader.registerEventListener(
        "renderToolbar",
        async () => {
          await this.registerReaderButton(await ztoolkit.Reader.getReader());
        },
        config.addonID
      );
    }
    /**
     * 注册PDF阅读按钮
     * @param reader 
     */
    async registerReaderButton(reader) {
      let _window;
      while (!(_window = reader?._iframeWindow?.wrappedJSObject)) {
        await Zotero.Promise.delay(10);
      }
      const imgBase64String = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVMAAAFTCAMAAACzlR9GAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAD2UExURQAAAP8AAP////+AgP9VVf9AQP+AgP9mZv9VVf+AgP9tbf9gYP9VVf9xcf9mZv9dXf9qav9iYv9bW/9tbf9mZv9gYP9paf9jY/9eXv9ra/9mZv9hYf9dXf9oaP9kZP9gYP9qav9mZv9iYv9eXv9oaP9kZP9hYf9qav9mZv9jY/9gYP9oaP9kZP9jY/9hYf9kZP9lZf9iYv9jY/9lZf9kZP9lZf9kZP9kZP9jY/9lZf9jY/9jY/9kZP9kZP9kZP9kZP9lZf9kZP9kZP9jY/9kZP9kZP9kZP9lZf9kZP9kZP9kZP9kZP9kZP9lZf9kZP9kZP9kZP9kZHgRAbAAAABRdFJOUwABAQIDBAQFBgYHCAkJCgsMDQ4ODxAREhMTFBUWFhcYGBkaGxscHR0eHyAgISQyQExOUFhjd3qAg4iOkJGgqbO0tb2+v8DHyNnc4Ozu9vf4+SLLQvsAAAAJcEhZcwAAMsAAADLAAShkWtsAABD1SURBVHhe7d15Y9u2GcdxrevaLkfjOLHsWpVcKbYqRdq6zTvr3Wu1++j7fzMjqa9lkQRJgAIegiA+fzniATy/gDdlj1JfffPNd19/vVwu5ombSeri4uzV808++l42PTL11Tff7T1syzbL2/l0Mr44e/4Rs0fNfkWiiXuCVFvffTEZn3/67EMWjCqRZ2pHeg1Wi9nV62ffZ/mo5GiYNg3UvM3d7PL8RdwjKOQy1RyoR2KyCqS5Z57p3mYxefsy7mcfkSbIqJXVPNnLfsBqB40wQTzt3c3Grz5m1YNFmCCZE91Nzga9IyBMEMrpNvPLV4M9chEmSMSO1ezi5SDPYgkTpGHP3eTNM1oaDsIESdi1vHoxrHsxhAlSsO72s7Mf0OAAECaIwIXl5PVQTrIIE9TvyGp6/gnNBo0wQfEOzd+EvxMgTFC4U+9n54HvBAgTlO3a8vpVyBdahAlqFvDu8iU9CA9hgoJlfPE20MsBwgTVSllPX4d4U4AwQa2C1lfhnV4RJihU1GYa2p1BwgRlSltcBDVYCRPUKO/L60/pUAAIE1TYidnrUK6wCBOU15HbcRgnV4QJiuvM6jqEKwHCBKV1aD3p/46VMEFhndpMX9G3viJMUFbXZme9fveCMEFN3bt53eMnroQJKvLB/E1vr64IE9Tjh9Wbnj5uJUxQjS/m573cAxAmqMUfN2c9HKuECSrxSQ/PrAgT1OGVzaRv11aECcrwzPqqX/cBCBMU4Z3luE83WAkTlOCh9UV/DlaECQrw0vyMLnuPMEH3PTV5Qac9R5ig875ajXvxVhBhgr77a3HegztWhAl67rOp//esCRP022vrS9/PqwgTdNtzt2/9vrVCmKDT3lt4PVQJE3TZf6uxxy8DECbocR/M/D1WESboby+sxr6+Z0mYoLs9cePprVXCBJ3ti/Wll0OVMEFf++MLH4cqYYKe9sj60r9bAIQJOtory+eU4g3CBN3sl9XYs7crCBP0sm+mfg1VwgR97J3b15TjBcIEXeyhK48OVYQJOthHN/5cqxIm6F8vfXnhyx1AwgTd66mJJ69WECboXF8t/HhcTZigb/116cObFYQJetZjPmz/hAk61mfz7u+qECboV68t31BaZwgTdKvnLjt+VkWYoFN9N+12p0qYoE+9t+h0p0qYoEv9t3pLfV0gTNCjEFx196iKMEF/grDo7E41YYLuhGHe1Z0qwgS9CcRdR5f/hAk6E4pVN6f/hAn6EozNuIvXqgkTdCUgVx1cUxEm6EhIJvKvqhIm6EdQZuIPqgkTdCMsC+lzKsIEvQjMnfDTf8IEnQjNRjZUwgR9CM5a9JYKYYIuhGdzQb0SCBP0IERjuSeqhAnaD9Kl2GsqhAmaD5NYqIQJWg/UZ0J3VAkTNB6qa5l7/4QJ2g7WROQtVcIETYfrc4lQCRO0HLC5wIGKMEHDIZu6v/dHmKDdoE2db/6ECZoN28T10Z8wQauBmzh+nkKYoNHQXbs9+SdM0Gbw3F5RESZoMnxXLk+pCBO0OACXDh/8EyZocAgcfkOFMEF74u7vHxL39/xTxJgE7CNM0Jys+x2tJx4EY3X2OIVaQGuSHmj60U4s1feu3lCjEtCaoKMx+uiBSc6tHL1LSR2gMTH3tJu3Y6pzt27eUKEM0JYYmi0SG6lzJ+9SUQVoSopiw98TC3Xm4s4fRYCWhBQPT0fEDlQTB1ep1AAakqHeme6J7VK3V/YvqKgBtCOjZpgKDlQH5/6UAJqRQZtqcgN1Y/39NEoAzYioHaaSA9X6aSoVgFZEVB709wQvUteWD/5UABoRQZNV5Db+5DTV7nfTqQC0IaF41N8Vxy3zibB7RkUBoAkJhd1psqkXUhbc+LfbS+KwggJACxIKmaYf8SNEM93YvEdFAaAFCYVNvfyR2PVpZmnxN1NQAGhAQj7A7Iik+EiOxeMUBYD1S1AMyvwOVTjT7efWjlMUAFYvwbtM7R2nKACsXYJ/mW5tHacoAKxcgiLT/IFfPlNbxykKACuX4GGmto5TFADWLSF/fupHptu5lRcpKACsWkI+032A+bGbfSTMys1U+g/WLEF1QOo+07WN+370H6xZQmOmXWz7ydb/Q4I5AQWAFUvIZ7pvmZ/3usl0e336LpUCwHpF0CSyOyb8vLc/bMk7/VEKBYDVisjvPP3JdHnyyykUAFYronzgz+8Ousp0e3Pql30oAKxVRPkg5Umm2yuyaYsCwEpl0CaSD/IjV/SedN454bREAWCdMko71O5PT3F32h/6pwCwThn5CJONn5/AXJ2YnnQvlQLAKmUUz1DLO9junHQvlQrAGoXQKO5Vd1W6sjrlth8VgDUKKWz8+X92m+n25oQv+lIBWKGQwsaf13Gmp9yhogKwPiG1mXZ4KpU5YeunArA+KfmtPY9ZutN+66cCsDopNQO128N+pvXWTwlgbVJqMu16d5pYtb2ZQglgbWKqN34PMt3etPx9FJQAViameqAyQ7dabv2UANYlh3bLmN6tlls/JYB1yana+H3Y9BPttn5qAKuSU7Xxe5Jpu+t+agBrElQxULs+43+0eklOJqgBrElQ/sbJAVO7N23xGJUawIoEqTd+Xzb9RItfQ08RYD2SlBu/R5kuzJ/4UQRYjyTlQGWaF8wPUxQBViNKMVA9uNh/Yn6YogqwGlGKgerRpp+Ymn4bnSrAWmSVB6ovZ1IwfTRNFWAlssoDlQm+MD1MUQVYiTAaP/Br008YHqYoA6xDWPG836tDVMrwXgplgHVIo/UDPvaH2WGKKsAqpBWPUt4N1K3RK+lUAdYgjdafeHbgTw5TJg/8KAKsQVj5Pop/A9Xkl1BSBFiBMMW9Ke8G6q3B70yhBrACYTSewyR/GDybogSwvCzlLVTvzlGX+t+bpASwvCz1bWnvtn79N9KpACwui7YL/Dvx1355mgrA4qLUw9TDgXpNZI0oACwtqipT7wbqe90rVAoAS4ui6TLvQp2SWRP6DxaWVDVME94d+zWvUOk+WFZSxQP+jG+71JneX0mh92BZSbSs5N3Wr/dgmt6DRQXVbPoJ37b+O603KOg8WFRQ3aaf8G3r1xqo9B0sKafqHbRHvm39Nzp7VPoOlpRTv+knfNv6dQYqXQcLyqHdGp5t/ToDlZ6DBcU0DtOEZ6FqnKPScbCcmIYjVMazXeqs+dBPx8FyUpqOUHuehdo8UOk3WExKadN/UA5cv45TM5KrRrfBYlJo9eChYuT6FWrjF1HpNVhKSGmYqj7LeBVq4+0pOg2WElLML0tOfdjy6uDfNFDpM1hICI0eZJlWHLeyBTzxOdlVoctgIRmqTV/1ccarg3/DI1S6DJaRQZsHjztN9dbvU6gNT6boMVhGRMUwTfDvAo9CXdUPVDoMlhGhPEJlKnapHoVa/1IK/QWLSCgFd3RoV+9SPQp1Ufs7veguWERC9TBNVNwH8CfU2lt+9BYsIYEWD3KZGoR6n/5N9F3qcZ5d+ifSmepK7QUqHQFLCKg+QmWq7q4chZpkWfo7XkeSZJnRibr3J+gBWEAADR4UA6gLtSHNJw5T/Yz8VGgdLOBewzBNVIX6nVaaj5ztBJY17/jSNljAPdo7UIyoioO/KVdjteZldFoG8ztXyktVuaVQHZ0s1JxO0TCY37nS9svneZZCdXRTq/p+P82C2V3TGqYJr0dq9W1UmgWzu1bKis9LjI5H1dyEWnmUolUwt2u0dlB9HLEUqpOtv/KbvTQK5nZMe5gmmONETgbqu6qjFI2CuR2jsYO6053K01QzTgZq1VGKNsHMbpkM06366bQxJwN1QoZFtAlmdou2DiqH6f29pd2po0xXFUcp2gQzO6U3TE3y3O0e7o88qMY2q7Wr4o930iSY1ymaOigP0yRPkwGqGudG+5fWKu740SSY16VStYXDh1mee6o7JYW18Kldm+ekmEeTYF6XaOkgN8ra70BLt6ELJwx8apn6uRRNglkdKg3Tp0xPPiJlN/jTaBU7j30Tti2Ub/jSJJjVIRo6eDwgNwe6S+Iq/Y/ocnN1WvGaD22COd1RD9PGQNM8M23Hsuo4ZoPy7QnaBHM6U74qSjbW+ph2hzz32g1VV5kuVb8ijTbBnM6YBlLIM9Mq1PJqLFE9lKZNMKMrRnEkA5TFisxTdTVM1aeoNApmdEU/jOTKiGVUjEN1l+lacX1Ko2BGR3SjUG3xBWapujrqpxS/yJNWwXxOaB6yK7f4ApNUne1NE4pHKLQK5nNAL1HdQDPaqbqMdLsqH/lpFsxnnVaiRoFm9FJ1tzPNlI/8tAtms0wnUfNAM4U/NqnQcsX6ym/30zKYzSqNwaRxUKpR9yjAeaKqjZ+2wWwWNSdaf9qkR3kbuuYM16rSxk/zYC5rNBK1V/bRDf5dduufz10rPZaiE2AuS7rf14lYFn/fLNWBuaxofIocRqKJ4jNp6gMzWdB0rA8m0ETxhh8lgplONqREk42/8BfmKBLMdKLG81HHZ+HiCi/3UyWY5zTNB3tmDEbh181SJZjnFBoXTaEN0+2CMEGZYJ4TaFw1BRdp8YvS1AlmaU3rLTzmDUn+Jip1glna0hikQQ7TwqUUhYJZ2tG5/ZRg7qDc5d6doFAwSytagzTMYbrd5n4nOpWCOdoYdKT5b6BRKpijBb3t3vFzjO7kHklTKpjDmOauNNhhul0dX55SK5jDVNUpVClplw+Fu3X8MhrFghkMVUS6Kz8sCnTLTxx/WYpiwQyGWDhvp3izMdQtPzEnzxTVghnMKPelaXz8eBDulr/dbo7e8aFcMIMR1UlUdn90QFt+4miHSrlguglVpNk2PqQtP3F0v496wXQTLHksG48Di/R4h0rBYLoBxTBVR9puX90f66czVAoG0w2w4JGKSIPemaaeHqBQMZisT52d4rIq8C0/8XTJT8lgsr5Splmk/Hwk/EiPXkSlZjBZH8sdpNkpdrEhn5k+evqbPRQNJutjuUcPFXdTgt+Zpg4PpSgaTNXHcniouD81iEif3u+jajBVXz5DdaJD2JmmDmf9lA2m6qtIMWcgkT6d9VM3mKpPI9OhRLpdP74zSeFgqr7mB/qDifTprJ/KwUQDLFhpQJEezvopHUw0oDgZPTakSA8P+qgdTDRQv/EP4yTq0a2lTGsH6rAi3W64NUX1YKKRylCHcEGax9so1A+mmRn2mf4xXu8jADDNkGqkDm+QJriSIgIwzVTpQX5Y34HQxoGfEMA0cw/HqQ400e32zmqmaarp78lKv5PIB0O0/zovYYJJUUv7q1PCBJOilt7GTK3bf0uSMMGkqKX9LVTCBJOillbZdyUIE0yK2sqe8xEmmBK1lR34CRNMidrKDvyECaZEbWVX/IQJpkRtZVf8hAmmRG1l3zonTDAlamuVvjRFmGBK1Fr6jJ8wwYSotfSvIBAmmBC1ln79hDDBhKi19ASVMMGEqLX0BJUwwYSotfQNdMIEE6LW0hNUwgQTotZWMVP7khNUwgSfR+0lJ6iECT6P2vs0ZmrdWczUuvOYqXXJhRRhgs+j9sYxU+uSi1PCBJ9H7V3HTK1LLvgJE3wetTeLmVo3j5la9y5mat1dzNS6VczUunXM1L4PYqbWfRgzte7jmKl1n8RMrXseM7XuZczUulcxU+vOYqbWncdMrbuImVo3jpladxUzte66kGl0in/88TdJptOYqV1//cl2FjO17L9fzWOmtv35XczUup/HTK37bczUur+M/sdPkS1/Gv2TnyJbfj36HT9Ftvxs9OLf/BjZ8YfRaPRLfo6s+M+PkkxHP/0X/4xO9+2P00hHoxff/i0e/W34++9/MRqNRv8HEgw9X2ry3tYAAAAASUVORK5CYII=`;
      const parent = _window.document.querySelector("#reader-ui .toolbar .start");
      const ref = parent.querySelector("#pageNumber");
      this.button = ztoolkit.UI.insertElementBefore({
        ignoreIfExists: true,
        namespace: "html",
        tag: "button",
        id: config.addonRef,
        classList: ["toolbar-button"],
        styles: {
          // margin: "0 .6em",
          width: "40px",
          filter: "grayscale(100%)",
          display: "flex",
          alignItems: "center"
        },
        attributes: {
          title: config.addonName,
          tabindex: "-1"
        },
        // 长按是解析图表，点击是切换
        listeners: [
          {
            type: "click",
            listener: () => {
              const menupopup = ztoolkit.UI.appendElement({
                tag: "menupopup",
                id: config.addonRef + "-menupopup",
                namespace: "xul",
                children: [
                  {
                    tag: "menuitem",
                    attributes: {
                      label: "PDF\u56FE\u8868\u89E3\u6790"
                    },
                    listeners: [
                      {
                        type: "command",
                        listener: () => {
                          this.addAnnotations(reader._item.id);
                        }
                      }
                    ]
                  },
                  {
                    tag: "menuseparator"
                  },
                  {
                    tag: "menuitem",
                    attributes: {
                      label: "\u4EC5\u663E\u793A\u56FE\u8868",
                      type: "checkbox",
                      checked: this.view == "Figure"
                    },
                    listeners: [
                      {
                        type: "command",
                        listener: () => {
                          this.clearFilter(reader);
                          if (this.view != "Figure") {
                            this.switchToView(reader, "Figure");
                          } else {
                            this.switchToView(reader, "All");
                          }
                        }
                      }
                    ]
                  },
                  {
                    tag: "menuitem",
                    attributes: {
                      label: "\u4EC5\u663E\u793A\u6807\u6CE8",
                      type: "checkbox",
                      checked: this.view == "Annotation"
                    },
                    listeners: [
                      {
                        type: "command",
                        listener: () => {
                          this.clearFilter(reader);
                          if (this.view != "Annotation") {
                            this.switchToView(reader, "Annotation");
                          } else {
                            this.switchToView(reader, "All");
                          }
                        }
                      }
                    ]
                  },
                  {
                    tag: "menuseparator"
                  },
                  {
                    tag: "menuitem",
                    attributes: {
                      label: "\u56FE\u8868\u8F6C\u7B14\u8BB0"
                    },
                    listeners: [
                      {
                        type: "command",
                        listener: async () => {
                          await this.addToNote(reader._item);
                        }
                      }
                    ]
                  },
                  {
                    tag: "menuitem",
                    attributes: {
                      label: "\u6E05\u7A7A\u56FE\u8868"
                    },
                    listeners: [
                      {
                        type: "click",
                        listener: async () => {
                          const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 }).createLine({ text: "Remove All Figures", type: "default" }).show();
                          this.switchToView(reader, "Figure", false);
                          let annos = reader._item.getAnnotations();
                          annos = annos.filter((a) => a.annotationType == "image" && a.getTags()?.[0]?.tag?.match(/^(Figure|Table)/));
                          await Promise.all(annos.map(async (anno) => await anno.eraseTx()));
                          popupWin.changeLine({ type: "success" });
                          popupWin.startCloseTimer(1e3);
                          this.button.style.filter = "grayscale(100%)";
                          this.switchToView(reader, "Annotation", false);
                        }
                      }
                    ]
                  }
                ]
              }, document.querySelector("#browser"));
              menupopup.openPopup(this.button, "after_start", 0, 0, false, false);
            }
          }
        ],
        properties: {
          innerHTML: `
        <span style="background: url(${imgBase64String}); background-size: 16px 16px; background-position: 35% center; background-repeat: no-repeat; display:block;width: 16px;height: 16px;margin-right: 5px;"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none"><path fill="currentColor" d="m0 2.707 4 4 4-4L7.293 2 4 5.293.707 2z"></path></svg>`
        }
      }, ref);
      if (reader._item.getAnnotations().find((i) => i.getTags().find((t) => t.tag.match(/^(Figure|Table)/)))) {
        this.button.style.filter = "none";
      }
      this.switchToView(reader, Zotero.Prefs.get(`${config.addonRef}.view`), false);
    }
    clearFilter(reader) {
      const am = reader._internalReader._annotationManager;
      am._filter.authors.forEach((i) => am._filter.authors.pop());
      am._filter.colors.forEach((i) => am._filter.colors.pop());
      am._filter.tags.forEach((i) => am._filter.tags.pop());
      am._filter.query = "";
      am.render();
    }
    /**
     * 切换显示图表/普通视图
     * @param reader 
     * @param isFigure 
     */
    switchToView(reader, view, isPopup = true) {
      Zotero.Prefs.set(`${config.addonRef}.view`, view);
      let popupWin;
      if (isPopup) {
        popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 }).createLine({ text: "Switch to " + view + " view", type: "default" }).show();
      }
      const am = reader._internalReader._annotationManager;
      am._render = am._render || am.render;
      am.render = () => {
        const isFilter = !(am._filter.authors.length == 0 && am._filter.colors.length == 0 && am._filter.query == "" && am._filter.tags.length == 0);
        am._annotations.forEach((anno) => {
          if (anno.tags.find((tag) => tag.name.startsWith("Figure") || tag.name.startsWith("Table"))) {
            if (view == "Annotation") {
              anno._hidden = true;
            } else {
              if (!isFilter) {
                delete anno._hidden;
              }
            }
          } else {
            if (view == "Figure") {
              anno._hidden = true;
            } else {
              if (!isFilter) {
                delete anno._hidden;
              }
            }
          }
        });
        am._render();
      };
      am.render();
      this.view = view;
      if (popupWin) {
        popupWin.changeLine({ type: "success" });
        popupWin.startCloseTimer(1e3);
      }
    }
    async getValidPDFFilepath(pdfItem) {
      let filepath = await pdfItem.getFilePathAsync();
      const origName = PathUtils.split(filepath).slice(-1)[0];
      if (origName.indexOf(",") >= 0) {
        const newName = origName.replace(/,/g, "_");
        if (Zotero.Prompt.confirm({
          title: "Confirm",
          text: `"${origName}" is not available for PDFFigures2, rename it to "${newName}".`,
          button0: "Rename",
          button1: "Cancel",
          checkbox: {}
        }) == 0) {
          await pdfItem.renameAttachmentFile(newName);
          filepath = await pdfItem.getFilePathAsync();
        }
      }
      return filepath;
    }
    getJsonFilepath(pdfItem) {
      const files = Zotero.File.pathToFile(this.dataDir).directoryEntries;
      let filepath;
      while (files.hasMoreElements()) {
        const file = files.getNext().QueryInterface(Components.interfaces.nsIFile);
        if (file.leafName.startsWith(pdfItem.key)) {
          filepath = window.PathUtils.join(this.dataDir, file.leafName);
          break;
        }
      }
      return filepath;
    }
    async readAsJson(filepath) {
      let rawString = await Zotero.File.getContentsAsync(filepath, "utf-8");
      if (rawString.indexOf("\uFFFD") >= 0) {
        rawString = await Zotero.File.getContentsAsync(filepath, "gbk");
      }
      return JSON.parse(rawString);
    }
    async getFigures(pdfItem, isFigure, popupWin) {
      const filename = await this.getValidPDFFilepath(pdfItem);
      const javaPath = Zotero.Prefs.get(`${config.addonRef}.path.java`);
      const jarPath = PathUtils.join(this.zoteroDir, "pdffigures2.jar");
      if (!javaPath) {
        window.alert("Java\u8DEF\u5F84\u5C1A\u672A\u914D\u7F6E\uFF0C\u8BF7\u53C2\u8003https://github.com/MuiseDestiny/zotero-figure\u914D\u7F6E");
        return [];
      }
      try {
        if (!await IOUtils.exists(javaPath)) {
          window.alert("Java\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u914D\u7F6E\uFF0C\u8BF7\u53C2\u8003https://github.com/MuiseDestiny/zotero-figure\u914D\u7F6E");
          return [];
        }
      } catch (e) {
        window.alert(`\u8DEF\u5F84${javaPath}\u9519\u8BEF`);
        return [];
      }
      try {
        if (!await IOUtils.exists(jarPath)) {
          window.alert(`pdffigures2.jar\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u4E0B\u8F7D\uFF0C\u5E76\u79FB\u52A8\u5230 ${this.zoteroDir} \u4E0B\uFF0C\u8BF7\u53C2\u8003https://github.com/MuiseDestiny/zotero-figure\u4E0B\u8F7D`);
          return [];
        }
      } catch (e) {
        window.alert(`\u8DEF\u5F84${jarPath}\u9519\u8BEF`);
        return [];
      }
      let args = [
        "-jar",
        jarPath,
        filename,
        "-d",
        PathUtils.join(this.dataDir, pdfItem.key)
        // "-m",
        // this.figureDir + "/",
        // "-i",
        // "300",
      ];
      if (isFigure) {
        args = [...args, ...[
          "-m",
          this.figureDir + "/",
          "-i",
          "300"
        ]];
      }
      if (!await IOUtils.exists(this.addonDir)) {
        await IOUtils.makeDirectory(this.addonDir);
      }
      if (!await IOUtils.exists(this.dataDir)) {
        await IOUtils.makeDirectory(this.dataDir);
      }
      if (!await IOUtils.exists(this.figureDir)) {
        await IOUtils.makeDirectory(this.figureDir);
      }
      let targetFile;
      popupWin?.createLine({ text: "Parsing figures...", type: "default" });
      ztoolkit.log(javaPath, args);
      try {
        await Zotero.Utilities.Internal.exec(javaPath, args);
      } catch (e) {
        ztoolkit.log(e);
      }
      popupWin?.createLine({ text: "Searching json...", type: "default" });
      let count = 0;
      while (!(targetFile = this.getJsonFilepath(pdfItem)) && count < 3) {
        await Zotero.Promise.delay(1e3);
        count += 1;
      }
      if (targetFile) {
        popupWin?.createLine({ text: "Reading json...", type: "success" });
        const figures = await this.readAsJson(targetFile);
        if (figures.length == 0) {
          popupWin?.createLine({ text: "No figures were parsed", type: "default" });
          popupWin?.createLine({ text: "Finished", type: "default" });
          popupWin?.startCloseTimer(3e3);
        }
        return figures;
      } else {
        popupWin?.createLine({ text: "Not Found", type: "fail" });
        return [];
      }
    }
    async addAnnotations(itemID) {
      const reader = await this.getReaderInstance(itemID);
      const popupWin = new ztoolkit.ProgressWindow(config.addonName.split(" ").slice(-1)[0], { closeOtherProgressWindows: true, closeTime: -1 }).createLine({ text: "Start", type: "default" }).show();
      const figures = await this.getFigures(await Zotero.Items.getAsync(itemID), false, popupWin);
      if (figures.length) {
        window.setTimeout(() => {
          this.button.style.filter = "none";
        });
        this.switchToView(reader, "Figure", false);
        const t = figures.length;
        const idx = popupWin.lines.length;
        popupWin.createLine({ text: `[0/${t}] Add to Annotation`, progress: 0, type: "default" });
        const pdfWin = reader._iframeWindow.wrappedJSObject.document.querySelector("iframe").contentWindow;
        const height = pdfWin.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3];
        for (let figure of figures) {
          const y1 = height - figure.regionBoundary.y2;
          const y2 = height - figure.regionBoundary.y1;
          figure.regionBoundary.y1 = y1;
          figure.regionBoundary.y2 = y2;
          await generateImageAnnotation(
            Zotero,
            reader,
            figure.page,
            Object.values(figure.regionBoundary),
            figure.caption,
            figure.figType + " " + figure.name
          );
          const i = figures.indexOf(figure) + 1;
          popupWin.changeLine({
            progress: i / t * 100,
            text: `[${i}/${t}] Add to Annotation`,
            idx
          });
        }
        popupWin.changeLine({
          progress: 100,
          text: `[${t}/${t}] Add to Annotation`,
          idx
        });
        popupWin.changeLine({ text: "Done", type: "success", idx });
        popupWin.startCloseTimer(3e3);
        this.switchToView(reader, "Annotation", false);
      }
      ztoolkit.log("render");
      await Zotero.PDFRenderer.renderAttachmentAnnotations(itemID);
    }
  };
  function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
    let left = bx2 < ax1;
    let right = ax2 < bx1;
    let bottom = by2 < ay1;
    let top = ay2 < by1;
    if (top && left) {
      return Math.hypot(ax1 - bx2, ay2 - by1);
    } else if (left && bottom) {
      return Math.hypot(ax1 - bx2, ay1 - by2);
    } else if (bottom && right) {
      return Math.hypot(ax2 - bx1, ay1 - by2);
    } else if (right && top) {
      return Math.hypot(ax2 - bx1, ay2 - by1);
    } else if (left) {
      return ax1 - bx2;
    } else if (right) {
      return bx1 - ax2;
    } else if (bottom) {
      return ay1 - by2;
    } else if (top) {
      return by1 - ay2;
    }
    return 0;
  }
  function getClosestOffset(chars, rect) {
    let dist = Infinity;
    let idx = 0;
    for (let i = 0; i < chars.length; i++) {
      let ch = chars[i];
      let distance = rectsDist(ch.rect, rect);
      if (distance < dist) {
        dist = distance;
        idx = i;
      }
    }
    return idx;
  }
  function applyTransform(p, m) {
    const xt = p[0] * m[0] + p[1] * m[2] + m[4];
    const yt = p[0] * m[1] + p[1] * m[3] + m[5];
    return [xt, yt];
  }
  function normalizeRect(rect) {
    const r = rect.slice(0);
    if (rect[0] > rect[2]) {
      r[0] = rect[2];
      r[2] = rect[0];
    }
    if (rect[1] > rect[3]) {
      r[1] = rect[3];
      r[3] = rect[1];
    }
    return r;
  }
  function getAxialAlignedBoundingBox(r, m) {
    const p1 = applyTransform(r, m);
    const p2 = applyTransform(r.slice(2, 4), m);
    const p3 = applyTransform([r[0], r[3]], m);
    const p4 = applyTransform([r[2], r[1]], m);
    return [
      Math.min(p1[0], p2[0], p3[0], p4[0]),
      Math.min(p1[1], p2[1], p3[1], p4[1]),
      Math.max(p1[0], p2[0], p3[0], p4[0]),
      Math.max(p1[1], p2[1], p3[1], p4[1])
    ];
  }
  function getRotationTransform(rect, degrees) {
    degrees = degrees * Math.PI / 180;
    let cosValue = Math.cos(degrees);
    let sinValue = Math.sin(degrees);
    let m = [cosValue, sinValue, -sinValue, cosValue, 0, 0];
    rect = normalizeRect(rect);
    let x1 = rect[0] + (rect[2] - rect[0]) / 2;
    let y1 = rect[1] + (rect[3] - rect[1]) / 2;
    let rect2 = getAxialAlignedBoundingBox(rect, m);
    let x2 = rect2[0] + (rect2[2] - rect2[0]) / 2;
    let y2 = rect2[1] + (rect2[3] - rect2[1]) / 2;
    let deltaX = x1 - x2;
    let deltaY = y1 - y2;
    m[4] = deltaX;
    m[5] = deltaY;
    return m;
  }
  function getPositionBoundingRect(position, pageIndex) {
    if (position.rects) {
      let rects = position.rects;
      if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
        rects = position.nextPageRects;
      }
      if (position.rotation) {
        let rect = rects[0];
        let tm = getRotationTransform(rect, position.rotation);
        let p1 = applyTransform([rect[0], rect[1]], tm);
        let p2 = applyTransform([rect[2], rect[3]], tm);
        let p3 = applyTransform([rect[2], rect[1]], tm);
        let p4 = applyTransform([rect[0], rect[3]], tm);
        return [
          Math.min(p1[0], p2[0], p3[0], p4[0]),
          Math.min(p1[1], p2[1], p3[1], p4[1]),
          Math.max(p1[0], p2[0], p3[0], p4[0]),
          Math.max(p1[1], p2[1], p3[1], p4[1])
        ];
      }
      return [
        Math.min(...rects.map((x) => x[0])),
        Math.min(...rects.map((x) => x[1])),
        Math.max(...rects.map((x) => x[2])),
        Math.max(...rects.map((x) => x[3]))
      ];
    } else if (position.paths) {
      let x = position.paths[0][0];
      let y = position.paths[0][1];
      let rect = [x, y, x, y];
      for (let path of position.paths) {
        for (let i = 0; i < path.length - 1; i += 2) {
          let x2 = path[i];
          let y2 = path[i + 1];
          rect[0] = Math.min(rect[0], x2);
          rect[1] = Math.min(rect[1], y2);
          rect[2] = Math.max(rect[2], x2);
          rect[3] = Math.max(rect[3], y2);
        }
      }
      return rect;
    }
  }
  function getTopMostRectFromPosition(position) {
    return position?.rects?.slice().sort((a, b) => b[2] - a[2])[0];
  }
  function getSortIndex(pdfPages, position) {
    let { pageIndex } = position;
    let offset = 0;
    let top = 0;
    if (pdfPages[position.pageIndex]) {
      let { chars } = pdfPages[position.pageIndex];
      let viewBox = pdfPages[position.pageIndex].viewBox;
      let rect = getTopMostRectFromPosition(position) || getPositionBoundingRect(position, null);
      offset = chars.length && getClosestOffset(chars, rect) || 0;
      let pageHeight = viewBox[3] - viewBox[1];
      top = pageHeight - rect[3];
      if (top < 0) {
        top = 0;
      }
    }
    return [
      pageIndex.toString().slice(0, 5).padStart(5, "0"),
      offset.toString().slice(0, 6).padStart(6, "0"),
      Math.floor(top).toString().slice(0, 5).padStart(5, "0")
    ].join("|");
  }
  function _generateObjectKey() {
    let len = 8;
    let allowedKeyChars = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    var randomstring = "";
    for (var i = 0; i < len; i++) {
      var rnum = Math.floor(Math.random() * allowedKeyChars.length);
      randomstring += allowedKeyChars.substring(rnum, rnum + 1);
    }
    return randomstring;
  }
  async function generateImageAnnotation(Zotero2, reader, pageIndex, rect, comment, tag) {
    const pdfPages = reader._internalReader._primaryView._pdfPages;
    const attachment = reader._item;
    let annotation = {
      type: "image",
      color: "#d2d8e2",
      pageLabel: String(pageIndex + 1),
      position: {
        pageIndex,
        rects: [rect]
      }
    };
    annotation.sortIndex = getSortIndex(pdfPages, annotation.position);
    annotation.pageLabel = annotation.pageLabel || "";
    annotation.text = annotation.text || "";
    annotation.comment = comment;
    annotation.tags = annotation.tags || [];
    annotation.key = annotation.id = _generateObjectKey();
    annotation.dateCreated = (/* @__PURE__ */ new Date()).toISOString();
    annotation.dateModified = annotation.dateCreated;
    annotation.authorName = "zoterofigure";
    if (annotation.position.rects) {
      annotation.position.rects = annotation.position.rects.map(
        (rect2) => rect2.map((value) => parseFloat(value.toFixed(3)))
      );
    }
    const savedAnnotation = await Zotero2.Annotations.saveFromJSON(attachment, annotation);
    savedAnnotation.addTag(tag);
    await savedAnnotation.saveTx();
  }

  // src/hooks.ts
  async function onStartup() {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise
    ]);
    await onMainWindowLoad(window);
  }
  async function onMainWindowLoad(win) {
    const views = new Views();
  }
  async function onMainWindowUnload(win) {
    ztoolkit.unregisterAll();
    addon.data.dialog?.window?.close();
  }
  function onShutdown() {
    ztoolkit.unregisterAll();
    addon.data.dialog?.window?.close();
    addon.data.alive = false;
    delete Zotero[config.addonInstance];
  }
  async function onNotify(event, type, ids, extraData) {
    ztoolkit.log("notify", event, type, ids, extraData);
    if (event == "select" && type == "tab" && extraData[ids[0]].type == "reader") {
    } else {
      return;
    }
  }
  async function onPrefsEvent(type, data) {
    switch (type) {
      case "load":
        break;
      default:
        return;
    }
  }
  var hooks_default = {
    onStartup,
    onShutdown,
    onMainWindowLoad,
    onMainWindowUnload,
    onNotify,
    onPrefsEvent
  };

  // src/utils/ztoolkit.ts
  function createZToolkit() {
    const _ztoolkit = new ZoteroToolkit();
    initZToolkit(_ztoolkit);
    return _ztoolkit;
  }
  function initZToolkit(_ztoolkit) {
    const env = "production";
    _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
    _ztoolkit.basicOptions.log.disableConsole = env === "production";
    _ztoolkit.UI.basicOptions.ui.enableElementJSONLog = false;
    _ztoolkit.UI.basicOptions.ui.enableElementDOMLog = false;
    _ztoolkit.basicOptions.debug.disableDebugBridgePassword = false;
    _ztoolkit.ProgressWindow.setIconURI(
      "default",
      `chrome://${config.addonRef}/content/icons/favicon.png`
    );
    _ztoolkit.ProgressWindow.setIconURI(
      "success",
      `chrome://zotero/skin/tick@2x.png`
    );
    _ztoolkit.ProgressWindow.setIconURI(
      "fail",
      `chrome://zotero/skin/cross.png`
    );
  }

  // src/addon.ts
  var Addon = class {
    constructor() {
      this.data = {
        alive: true,
        env: "production",
        ztoolkit: createZToolkit()
      };
      this.hooks = hooks_default;
      this.api = {};
    }
  };
  var addon_default = Addon;

  // src/index.ts
  var basicTool2 = new BasicTool();
  if (!basicTool2.getGlobal("Zotero")[config.addonInstance]) {
    _globalThis.Zotero = basicTool2.getGlobal("Zotero");
    defineGlobal("window");
    defineGlobal("document");
    defineGlobal("ZoteroPane");
    defineGlobal("Zotero_Tabs");
    _globalThis.addon = new addon_default();
    _globalThis.ztoolkit = addon.data.ztoolkit;
    Zotero[config.addonInstance] = addon;
    addon.hooks.onStartup();
  }
  function defineGlobal(name) {
    Object.defineProperty(_globalThis, name, {
      get() {
        return basicTool2.getGlobal(name);
      }
    });
  }
})();
