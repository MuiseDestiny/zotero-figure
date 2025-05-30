"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/debugBridge.js
  var require_debugBridge = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/debugBridge.js"(exports) {
      "use strict";
      var __importDefault = exports && exports.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.DebugBridge = void 0;
      var basic_1 = require_basic();
      var toolkitGlobal_1 = __importDefault(require_toolkitGlobal());
      var DebugBridge = class {
        get version() {
          return DebugBridge.version;
        }
        get disableDebugBridgePassword() {
          return this._disableDebugBridgePassword;
        }
        set disableDebugBridgePassword(value) {
          this._disableDebugBridgePassword = value;
        }
        get password() {
          return basic_1.BasicTool.getZotero().Prefs.get(DebugBridge.passwordPref, true);
        }
        set password(v) {
          basic_1.BasicTool.getZotero().Prefs.set(DebugBridge.passwordPref, v, true);
        }
        constructor() {
          this._disableDebugBridgePassword = false;
          this.initializeDebugBridge();
        }
        static setModule(instance) {
          var _a;
          if (!((_a = instance.debugBridge) === null || _a === void 0 ? void 0 : _a.version) || instance.debugBridge.version < DebugBridge.version) {
            instance.debugBridge = new DebugBridge();
          }
        }
        initializeDebugBridge() {
          const debugBridgeExtension = {
            noContent: true,
            doAction: async (uri) => {
              var _a;
              const Zotero2 = basic_1.BasicTool.getZotero();
              const window2 = Zotero2.getMainWindow();
              const uriString = uri.spec.split("//").pop();
              if (!uriString) {
                return;
              }
              const params = {};
              (_a = uriString.split("?").pop()) === null || _a === void 0 ? void 0 : _a.split("&").forEach((p) => {
                params[p.split("=")[0]] = decodeURIComponent(p.split("=")[1]);
              });
              const skipPasswordCheck = toolkitGlobal_1.default.getInstance().debugBridge.disableDebugBridgePassword;
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
                    const AsyncFunction = Object.getPrototypeOf(async function() {
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
            newChannel: function(uri) {
              this.doAction(uri);
            }
          };
          Services.io.getProtocolHandler("zotero").wrappedJSObject._extensions["zotero://ztoolkit-debug"] = debugBridgeExtension;
        }
      };
      exports.DebugBridge = DebugBridge;
      DebugBridge.version = 2;
      DebugBridge.passwordPref = "extensions.zotero.debug-bridge.password";
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/pluginBridge.js
  var require_pluginBridge = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/pluginBridge.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.PluginBridge = void 0;
      var basic_1 = require_basic();
      var PluginBridge = class {
        get version() {
          return PluginBridge.version;
        }
        constructor() {
          this.initializePluginBridge();
        }
        static setModule(instance) {
          var _a;
          if (!((_a = instance.pluginBridge) === null || _a === void 0 ? void 0 : _a.version) || instance.pluginBridge.version < PluginBridge.version) {
            instance.pluginBridge = new PluginBridge();
          }
        }
        initializePluginBridge() {
          const { AddonManager } = ChromeUtils.import("resource://gre/modules/AddonManager.jsm");
          const Zotero2 = basic_1.BasicTool.getZotero();
          const pluginBridgeExtension = {
            noContent: true,
            doAction: async (uri) => {
              var _a;
              try {
                const uriString = uri.spec.split("//").pop();
                if (!uriString) {
                  return;
                }
                const params = {};
                (_a = uriString.split("?").pop()) === null || _a === void 0 ? void 0 : _a.split("&").forEach((p) => {
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
            newChannel: function(uri) {
              this.doAction(uri);
            }
          };
          Services.io.getProtocolHandler("zotero").wrappedJSObject._extensions["zotero://plugin"] = pluginBridgeExtension;
        }
      };
      exports.PluginBridge = PluginBridge;
      PluginBridge.version = 1;
      function hint(content, success) {
        const progressWindow = new Zotero.ProgressWindow({ closeOnClick: true });
        progressWindow.changeHeadline("Plugin Toolkit");
        progressWindow.progress = new progressWindow.ItemProgress(success ? "chrome://zotero/skin/tick.png" : "chrome://zotero/skin/cross.png", content);
        progressWindow.progress.setProgress(100);
        progressWindow.show();
        progressWindow.startCloseTimer(5e3);
      }
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/toolkitGlobal.js
  var require_toolkitGlobal = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/toolkitGlobal.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ToolkitGlobal = void 0;
      var basic_1 = require_basic();
      var debugBridge_1 = require_debugBridge();
      var pluginBridge_1 = require_pluginBridge();
      var ToolkitGlobal = class {
        constructor() {
          initializeModules(this);
          this.currentWindow = basic_1.BasicTool.getZotero().getMainWindow();
        }
        /**
         * Get the global unique instance of `class ToolkitGlobal`.
         * @returns An instance of `ToolkitGlobal`.
         */
        static getInstance() {
          const Zotero2 = basic_1.BasicTool.getZotero();
          let requireInit = false;
          if (!("_toolkitGlobal" in Zotero2)) {
            Zotero2._toolkitGlobal = new ToolkitGlobal();
            requireInit = true;
          }
          const currentGlobal = Zotero2._toolkitGlobal;
          if (currentGlobal.currentWindow !== Zotero2.getMainWindow()) {
            checkWindowDependentModules(currentGlobal);
            requireInit = true;
          }
          if (requireInit) {
            initializeModules(currentGlobal);
          }
          return currentGlobal;
        }
      };
      exports.ToolkitGlobal = ToolkitGlobal;
      function initializeModules(instance) {
        setModule(instance, "prompt", {
          _ready: false,
          instance: void 0
        });
        debugBridge_1.DebugBridge.setModule(instance);
        pluginBridge_1.PluginBridge.setModule(instance);
      }
      function setModule(instance, key, module2) {
        var _a;
        var _b;
        if (!module2) {
          return;
        }
        if (!instance[key]) {
          instance[key] = module2;
        }
        for (const moduleKey in module2) {
          (_a = (_b = instance[key])[moduleKey]) !== null && _a !== void 0 ? _a : _b[moduleKey] = module2[moduleKey];
        }
      }
      function checkWindowDependentModules(instance) {
        instance.currentWindow = basic_1.BasicTool.getZotero().getMainWindow();
        instance.prompt = void 0;
      }
      exports.default = ToolkitGlobal;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/basic.js
  var require_basic = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/basic.js"(exports) {
      "use strict";
      var __importDefault = exports && exports.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ManagerTool = exports.BasicTool = void 0;
      exports.unregister = unregister;
      exports.makeHelperTool = makeHelperTool;
      var toolkitGlobal_1 = __importDefault(require_toolkitGlobal());
      var BasicTool2 = class {
        get basicOptions() {
          return this._basicOptions;
        }
        /**
         *
         * @param basicTool Pass an BasicTool instance to copy its options.
         */
        constructor(data) {
          this.patchSign = "zotero-plugin-toolkit@3.0.0";
          this._basicOptions = {
            log: {
              _type: "toolkitlog",
              disableConsole: false,
              disableZLog: false,
              prefix: ""
            },
            debug: toolkitGlobal_1.default.getInstance().debugBridge,
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
          let { ConsoleAPI } = Components.utils.import("resource://gre/modules/Console.jsm");
          this._console = new ConsoleAPI({
            consoleID: `${this._basicOptions.api.pluginID}-${Date.now()}`
          });
          this.updateOptions(data);
          return;
        }
        getGlobal(k) {
          const _Zotero = typeof Zotero !== "undefined" ? Zotero : (
            // @ts-ignore
            Components.classes["@zotero.org/Zotero;1"].getService(Components.interfaces.nsISupports).wrappedJSObject
          );
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
          var _a, _b;
          if (data.length === 0) {
            return;
          }
          const Zotero2 = this.getGlobal("Zotero");
          let options;
          if (((_a = data[data.length - 1]) === null || _a === void 0 ? void 0 : _a._type) === "toolkitlog") {
            options = data.pop();
          } else {
            options = this._basicOptions.log;
          }
          try {
            if (options.prefix) {
              data.splice(0, 0, options.prefix);
            }
            if (!options.disableConsole) {
              let console = (_b = Zotero2.getMainWindow()) === null || _b === void 0 ? void 0 : _b.console;
              if (!console) {
                console = this._console;
              }
              if (console.groupCollapsed) {
                console.groupCollapsed(...data);
              } else {
                console.group(...data);
              }
              console.trace();
              console.groupEnd();
            }
            if (!options.disableZLog) {
              Zotero2.debug(data.map((d) => {
                try {
                  return typeof d === "object" ? JSON.stringify(d) : String(d);
                } catch (e) {
                  Zotero2.debug(d);
                  return "";
                }
              }).join("\n"));
            }
          } catch (e) {
            Zotero2.logError(e);
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
          if (source instanceof BasicTool2) {
            this._basicOptions = source._basicOptions;
          } else {
            this._basicOptions = source;
          }
          return this;
        }
        static getZotero() {
          return typeof Zotero !== "undefined" ? Zotero : (
            // @ts-ignore
            Components.classes["@zotero.org/Zotero;1"].getService(Components.interfaces.nsISupports).wrappedJSObject
          );
        }
      };
      exports.BasicTool = BasicTool2;
      var ManagerTool = class extends BasicTool2 {
        _ensureAutoUnregisterAll() {
          this.addListenerCallback("onPluginUnload", (params, reason) => {
            if (params.id !== this.basicOptions.api.pluginID) {
              return;
            }
            this.unregisterAll();
          });
        }
      };
      exports.ManagerTool = ManagerTool;
      function unregister(tools) {
        Object.values(tools).forEach((tool) => {
          if (tool instanceof ManagerTool || typeof (tool === null || tool === void 0 ? void 0 : tool.unregisterAll) === "function") {
            tool.unregisterAll();
          }
        });
      }
      function makeHelperTool(cls, options) {
        return new Proxy(cls, {
          construct(target, args) {
            const _origin = new cls(...args);
            if (_origin instanceof BasicTool2) {
              _origin.updateOptions(options);
            }
            return _origin;
          }
        });
      }
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/ui.js
  var require_ui = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/ui.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.UITool = void 0;
      var basic_1 = require_basic();
      var UITool = class extends basic_1.BasicTool {
        get basicOptions() {
          return this._basicOptions;
        }
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
            var _a;
            try {
              (_a = e === null || e === void 0 ? void 0 : e.deref()) === null || _a === void 0 ? void 0 : _a.remove();
            } catch (e2) {
              this.log(e2);
            }
          });
        }
        createElement(...args) {
          var _a, _b, _c;
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
            if ((_a = props.classList) === null || _a === void 0 ? void 0 : _a.length) {
              realElem.classList.add(...props.classList);
            }
            if ((_b = props.listeners) === null || _b === void 0 ? void 0 : _b.length) {
              props.listeners.forEach(({ type, listener, options }) => {
                listener && realElem.addEventListener(type, listener, options);
              });
            }
            elem = realElem;
          }
          if ((_c = props.children) === null || _c === void 0 ? void 0 : _c.length) {
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
         * @returns
         */
        insertElementBefore(properties, referenceNode) {
          if (referenceNode.parentNode)
            return referenceNode.parentNode.insertBefore(this.createElement(referenceNode.ownerDocument, properties.tag, properties), referenceNode);
          else
            this.log(referenceNode.tagName + " has no parent, cannot insert " + properties.tag);
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
            this.log(oldNode.tagName + " has no parent, cannot replace it with " + properties.tag);
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
          let parser = new DOMParser();
          const xulns = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
          const htmlns = "http://www.w3.org/1999/xhtml";
          const wrappedStr = `${entities.length ? `<!DOCTYPE bindings [ ${entities.reduce((preamble, url, index) => {
            return preamble + `<!ENTITY % _dtd-${index} SYSTEM "${url}"> %_dtd-${index}; `;
          }, "")}]>` : ""}
      <html:div xmlns="${defaultXUL ? xulns : htmlns}"
          xmlns:xul="${xulns}" xmlns:html="${htmlns}">
      ${str}
      </html:div>`;
          this.log(wrappedStr, parser);
          let doc = parser.parseFromString(wrappedStr, "text/xml");
          this.log(doc);
          if (doc.documentElement.localName === "parsererror") {
            throw new Error("not well-formed XHTML");
          }
          let range = doc.createRange();
          range.selectNodeContents(doc.querySelector("div"));
          return range.extractContents();
        }
      };
      exports.UITool = UITool;
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
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/wait.js
  var require_wait = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/utils/wait.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.waitUntil = waitUntil;
      exports.waitUtilAsync = waitUtilAsync;
      exports.waitForReader = waitForReader;
      var basic_1 = require_basic();
      var basicTool2 = new basic_1.BasicTool();
      function waitUntil(condition, callback, interval = 100, timeout = 1e4) {
        const start = Date.now();
        const intervalId = basicTool2.getGlobal("setInterval")(() => {
          if (condition()) {
            basicTool2.getGlobal("clearInterval")(intervalId);
            callback();
          } else if (Date.now() - start > timeout) {
            basicTool2.getGlobal("clearInterval")(intervalId);
          }
        }, interval);
      }
      function waitUtilAsync(condition, interval = 100, timeout = 1e4) {
        return new Promise((resolve, reject) => {
          const start = Date.now();
          const intervalId = basicTool2.getGlobal("setInterval")(() => {
            if (condition()) {
              basicTool2.getGlobal("clearInterval")(intervalId);
              resolve();
            } else if (Date.now() - start > timeout) {
              basicTool2.getGlobal("clearInterval")(intervalId);
              reject();
            }
          }, interval);
        });
      }
      async function waitForReader(reader) {
        await reader._initPromise;
        await reader._lastView.initializedPromise;
        if (reader.type == "pdf")
          await reader._lastView._iframeWindow.PDFViewerApplication.initializedPromise;
      }
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/reader.js
  var require_reader = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/reader.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ReaderTool = void 0;
      var basic_1 = require_basic();
      var wait_1 = require_wait();
      var ReaderTool = class extends basic_1.BasicTool {
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
            await Zotero.Promise.delay(checkPeriod);
            reader = Zotero.Reader.getByTabID(Zotero_Tabs2.selectedID);
            delayCount++;
          }
          await (reader === null || reader === void 0 ? void 0 : reader._initPromise);
          return reader;
        }
        /**
         * Get all window readers.
         */
        getWindowReader() {
          const Zotero_Tabs2 = this.getGlobal("Zotero_Tabs");
          let windowReaders = [];
          let tabs = Zotero_Tabs2._tabs.map((e) => e.id);
          for (let i = 0; i < Zotero.Reader._readers.length; i++) {
            let flag = false;
            for (let j = 0; j < tabs.length; j++) {
              if (Zotero.Reader._readers[i].tabID == tabs[j]) {
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
          var _a;
          const deck = (_a = this.getGlobal("window").document.querySelector(".notes-pane-deck")) === null || _a === void 0 ? void 0 : _a.previousElementSibling;
          return deck;
        }
        /**
         * Add a reader tabpanel deck selection change observer.
         * @deprecated - use item pane api
         * @alpha
         * @param callback
         */
        async addReaderTabPanelDeckObserver(callback) {
          await (0, wait_1.waitUtilAsync)(() => !!this.getReaderTabPanelDeck());
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
          var _a;
          const annotation = (
            // @ts-ignore
            (_a = reader === null || reader === void 0 ? void 0 : reader._internalReader._lastView._selectionPopup) === null || _a === void 0 ? void 0 : _a.annotation
          );
          return annotation;
        }
        /**
         * Get the text selection of reader.
         * @param reader Target reader
         * @returns The text selection of reader.
         */
        getSelectedText(reader) {
          var _a, _b;
          return (_b = (_a = this.getSelectedAnnotationData(reader)) === null || _a === void 0 ? void 0 : _a.text) !== null && _b !== void 0 ? _b : "";
        }
      };
      exports.ReaderTool = ReaderTool;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/extraField.js
  var require_extraField = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/tools/extraField.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ExtraFieldTool = void 0;
      var basic_1 = require_basic();
      var ExtraFieldTool = class extends basic_1.BasicTool {
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
          let kvs = [];
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
      exports.ExtraFieldTool = ExtraFieldTool;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/prompt.js
  var require_prompt = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/prompt.js"(exports) {
      "use strict";
      var __importDefault = exports && exports.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.PromptManager = exports.Prompt = void 0;
      var basic_1 = require_basic();
      var basic_2 = require_basic();
      var ui_1 = require_ui();
      var toolkitGlobal_1 = __importDefault(require_toolkitGlobal());
      var Prompt = class {
        get document() {
          return this.base.getGlobal("document");
        }
        /**
         * Initialize `Prompt` but do not create UI.
         */
        constructor() {
          this.lastInputText = "";
          this.defaultText = {
            placeholder: "Select a command...",
            empty: "No commands found."
          };
          this.maxLineNum = 12;
          this.maxSuggestionNum = 100;
          this.commands = [];
          this.base = new basic_1.BasicTool();
          this.ui = new ui_1.UITool();
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
          for (let command of commands) {
            try {
              if (!command.name || command.when && !command.when()) {
                continue;
              }
            } catch (_a) {
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
            return e.style.display != "none";
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
          [...Array.from(this.promptNode.querySelectorAll(".commands-container"))].find((e) => e.style.display != "none").querySelector(".selected").click();
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
          var _w = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~]/, jw = /\s/, Ww = /[\u0F00-\u0FFF\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
          function Yw(e2, t, n, i) {
            if (0 === e2.length)
              return 0;
            var r = 0;
            r -= Math.max(0, e2.length - 1), r -= i / 10;
            var o = e2[0][0];
            return r -= (e2[e2.length - 1][1] - o + 1 - t) / 100, r -= o / 1e3, r -= n / 1e4;
          }
          function $w(e2, t, n, i) {
            if (0 === e2.length)
              return null;
            for (var r = n.toLowerCase(), o = 0, a = 0, s = [], l = 0; l < e2.length; l++) {
              var c = e2[l], u = r.indexOf(c, a);
              if (-1 === u)
                return null;
              var h = n.charAt(u);
              if (u > 0 && !_w.test(h) && !Ww.test(h)) {
                var p = n.charAt(u - 1);
                if (h.toLowerCase() !== h && p.toLowerCase() !== p || h.toUpperCase() !== h && !_w.test(p) && !jw.test(p) && !Ww.test(p))
                  if (i) {
                    if (u !== a) {
                      a += c.length, l--;
                      continue;
                    }
                  } else
                    o += 1;
              }
              if (0 === s.length)
                s.push([u, u + c.length]);
              else {
                var d = s[s.length - 1];
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
              var o = t.charAt(r);
              jw.test(o) ? (i !== r && n.push(t.substring(i, r)), i = r + 1) : (_w.test(o) || Ww.test(o)) && (i !== r && n.push(t.substring(i, r)), n.push(o), i = r + 1);
            }
            return i !== t.length && n.push(t.substring(i, t.length)), {
              query: e2,
              tokens: n,
              fuzzy: t.split("")
            };
          }
          function Xw(e2, t) {
            if ("" === e2.query)
              return {
                score: 0,
                matches: []
              };
            var n = $w(e2.tokens, e2.query, t, false);
            return n || $w(e2.fuzzy, e2.query, t, true);
          }
          var e = Gw(inputText);
          let container = this.getCommandsContainer();
          if (container.classList.contains("suggestions")) {
            this.exit();
          }
          if (inputText.trim() == "") {
            return true;
          }
          let suggestions = [];
          this.getCommandsContainer().querySelectorAll(".command").forEach((commandNode) => {
            let spanNode = commandNode.querySelector(".name span");
            let spanText = spanNode.innerText;
            let res = Xw(e, spanText);
            if (res) {
              commandNode = this.createCommandNode(commandNode.command);
              let spanHTML = "";
              let i = 0;
              for (let j = 0; j < res.matches.length; j++) {
                let [start, end] = res.matches[j];
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
            if (["ArrowUp", "ArrowDown"].indexOf(event.key) != -1) {
              event.preventDefault();
              let selectedIndex;
              let allItems = [
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
              let commandsContainer = this.getCommandsContainer();
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
            } else if (["ArrowUp", "ArrowDown"].indexOf(event.key) != -1) {
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
          let container = this.createCommandsContainer();
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
          const style = this.ui.createElement(this.document, "style", {
            namespace: "html",
            id: "prompt-style"
          });
          style.innerText = `
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
          this.document.documentElement.appendChild(style);
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
      exports.Prompt = Prompt;
      var PromptManager = class extends basic_2.ManagerTool {
        constructor(base) {
          super(base);
          this.commands = [];
          const globalCache = toolkitGlobal_1.default.getInstance().prompt;
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
          commands.forEach((c) => {
            var _a;
            return (_a = c.id) !== null && _a !== void 0 ? _a : c.id = c.name;
          });
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
      exports.PromptManager = PromptManager;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/menu.js
  var require_menu = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/menu.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.MenuManager = void 0;
      var ui_1 = require_ui();
      var basic_1 = require_basic();
      var MenuManager = class extends basic_1.ManagerTool {
        constructor(base) {
          super(base);
          this.ui = new ui_1.UITool(this);
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
            var _a, _b;
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
                  elementOption.attributes["class"] += " menu-iconic";
                } else {
                  elementOption.attributes["class"] += " menuitem-iconic";
                }
              }
              elementOption.styles["list-style-image"] = `url(${menuitemOption.icon})`;
            }
            if (menuitemOption.commandListener) {
              (_a = elementOption.listeners) === null || _a === void 0 ? void 0 : _a.push({
                type: "command",
                listener: menuitemOption.commandListener
              });
            }
            const menuItem = this.ui.createElement(doc, menuitemOption.tag, elementOption);
            if (menuitemOption.getVisibility) {
              popup === null || popup === void 0 ? void 0 : popup.addEventListener("popupshowing", (ev) => {
                const showing = menuitemOption.getVisibility(menuItem, ev);
                if (showing) {
                  menuItem.removeAttribute("hidden");
                } else {
                  menuItem.setAttribute("hidden", "true");
                }
              });
            }
            if (menuitemOption.tag === "menu") {
              const subPopup = this.ui.createElement(doc, "menupopup", {
                id: menuitemOption.popupId,
                attributes: { onpopupshowing: menuitemOption.onpopupshowing || "" }
              });
              (_b = menuitemOption.children) === null || _b === void 0 ? void 0 : _b.forEach((childOption) => {
                subPopup.append(genMenuElement(childOption));
              });
              menuItem.append(subPopup);
            }
            return menuItem;
          };
          const topMenuItem = genMenuElement(options);
          if (!anchorElement) {
            anchorElement = insertPosition === "after" ? popup.lastElementChild : popup.firstElementChild;
          }
          anchorElement[insertPosition](topMenuItem);
        }
        unregister(menuId) {
          var _a;
          (_a = this.getGlobal("document").querySelector(`#${menuId}`)) === null || _a === void 0 ? void 0 : _a.remove();
        }
        unregisterAll() {
          this.ui.unregisterAll();
        }
      };
      exports.MenuManager = MenuManager;
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
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/clipboard.js
  var require_clipboard = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/clipboard.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ClipboardHelper = void 0;
      var basic_1 = require_basic();
      var ClipboardHelper = class extends basic_1.BasicTool {
        constructor() {
          super();
          this.filePath = "";
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
          let parts = source.split(",");
          if (!parts[0].includes("base64")) {
            return this;
          }
          let mime = parts[0].match(/:(.*?);/)[1];
          let bstr = this.getGlobal("window").atob(parts[1]);
          let n = bstr.length;
          let u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          let imgTools = Components.classes["@mozilla.org/image/tools;1"].getService(Components.interfaces.imgITools);
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
      exports.ClipboardHelper = ClipboardHelper;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/filePicker.js
  var require_filePicker = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/filePicker.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.FilePickerHelper = void 0;
      var basic_1 = require_basic();
      var FilePickerHelper = class extends basic_1.BasicTool {
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
          let backend = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs").FilePicker;
          const fp = new backend();
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
      exports.FilePickerHelper = FilePickerHelper;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/progressWindow.js
  var require_progressWindow = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/progressWindow.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ProgressWindowHelper = void 0;
      var basic_1 = require_basic();
      var ProgressWindowHelper = class extends Zotero.ProgressWindow {
        /**
         *
         * @param header window header
         * @param options
         */
        constructor(header, options = {
          closeOnClick: true,
          closeTime: 5e3
        }) {
          super(options);
          this.lines = [];
          this.closeTime = options.closeTime || 5e3;
          this.changeHeadline(header);
          this.originalShow = this.show;
          this.show = this.showWithTimer;
          if (options.closeOtherProgressWindows) {
            basic_1.BasicTool.getZotero().ProgressWindowSet.closeAll();
          }
        }
        /**
         * Create a new line
         * @param options
         */
        createLine(options) {
          const icon = this.getIcon(options.type, options.icon);
          const line = new this.ItemProgress(icon || "", options.text || "");
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
         */
        changeLine(options) {
          var _a;
          if (((_a = this.lines) === null || _a === void 0 ? void 0 : _a.length) === 0) {
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
        showWithTimer(closeTime = void 0) {
          this.originalShow();
          typeof closeTime !== "undefined" && (this.closeTime = closeTime);
          if (this.closeTime && this.closeTime > 0) {
            this.startCloseTimer(this.closeTime);
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
              if (icon && icon.startsWith("chrome://") && !box.style.backgroundImage.includes("progress_arcs")) {
                box.style.backgroundImage = `url(${box.dataset.itemType})`;
              }
            });
          } catch (e) {
          }
        }
      };
      exports.ProgressWindowHelper = ProgressWindowHelper;
      var icons = {
        success: "chrome://zotero/skin/tick.png",
        fail: "chrome://zotero/skin/cross.png"
      };
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/virtualizedTable.js
  var require_virtualizedTable = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/virtualizedTable.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.VirtualizedTableHelper = void 0;
      var basic_1 = require_basic();
      var VirtualizedTableHelper = class extends basic_1.BasicTool {
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
            id: `${Zotero2.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`,
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
            const vtableProps = Object.assign({}, this.props, {
              ref: (ref) => this.treeInstance = ref
            });
            if (vtableProps.getRowData && !vtableProps.renderItem) {
              Object.assign(vtableProps, {
                renderItem: this.VirtualizedTable.makeRowRenderer(vtableProps.getRowData)
              });
            }
            const elem = this.React.createElement(this.IntlProvider, { locale: Zotero.locale, messages: Zotero.Intl.strings }, this.React.createElement(this.VirtualizedTable, vtableProps));
            const container = this.window.document.getElementById(this.containerId);
            new Promise((resolve) => this.ReactDOM.render(elem, container, resolve)).then(() => {
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
      exports.VirtualizedTableHelper = VirtualizedTableHelper;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/dialog.js
  var require_dialog = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/dialog.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.DialogHelper = void 0;
      var ui_1 = require_ui();
      var DialogHelper = class extends ui_1.UITool {
        /**
         * Create a dialog helper with row \* column grids.
         * @param row
         * @param column
         */
        constructor(row, column) {
          super();
          if (row <= 0 || column <= 0) {
            throw Error(`row and column must be positive integers.`);
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
            throw Error(`Cell index (${row}, ${column}) is invalid, maximum (${this.elementProps.children.length}, ${this.elementProps.children[0].children.length})`);
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
         * @param options.noClose Don't close window when clicking this button.
         * @param options.callback Callback of button click event.
         */
        addButton(label, id, options = {}) {
          id = id || `${Zotero.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`;
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
         *   loadLock?: _ZoteroTypes.PromiseObject; // resolve after window load (auto-generated)
         *   loadCallback?: Function; // called after window load
         *   unloadLock?: _ZoteroTypes.PromiseObject; // resolve after window unload (auto-generated)
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
          this.window = openDialog(this, `${Zotero.Utilities.randomString()}-${(/* @__PURE__ */ new Date()).getTime()}`, title, this.elementProps, this.dialogData, windowFeatures);
          return this;
        }
      };
      exports.DialogHelper = DialogHelper;
      function openDialog(dialogHelper, targetId, title, elementProps, dialogData, windowFeatures = {
        centerscreen: true,
        resizable: true,
        fitContent: true
      }) {
        var _a, _b, _c;
        const Zotero2 = dialogHelper.getGlobal("Zotero");
        dialogData = dialogData || {};
        if (!dialogData.loadLock) {
          dialogData.loadLock = Zotero2.Promise.defer();
        }
        if (!dialogData.unloadLock) {
          dialogData.unloadLock = Zotero2.Promise.defer();
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
        (_a = dialogData.loadLock) === null || _a === void 0 ? void 0 : _a.promise.then(() => {
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
          (dialogData === null || dialogData === void 0 ? void 0 : dialogData.loadCallback) && dialogData.loadCallback();
        });
        dialogData.unloadLock.promise.then(() => {
          (dialogData === null || dialogData === void 0 ? void 0 : dialogData.unloadCallback) && dialogData.unloadCallback();
        });
        win.addEventListener("DOMContentLoaded", function onWindowLoad(ev) {
          var _a2, _b2;
          (_b2 = (_a2 = win.arguments[0]) === null || _a2 === void 0 ? void 0 : _a2.loadLock) === null || _b2 === void 0 ? void 0 : _b2.resolve();
          win.removeEventListener("DOMContentLoaded", onWindowLoad, false);
        }, false);
        win.addEventListener("beforeunload", function onWindowBeforeUnload(ev) {
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
          (dialogData === null || dialogData === void 0 ? void 0 : dialogData.beforeUnloadCallback) && dialogData.beforeUnloadCallback();
        });
        win.addEventListener("unload", function onWindowUnload(ev) {
          var _a2, _b2, _c2;
          if ((_a2 = this.window.arguments[0]) === null || _a2 === void 0 ? void 0 : _a2.loadLock.promise.isPending()) {
            return;
          }
          (_c2 = (_b2 = this.window.arguments[0]) === null || _b2 === void 0 ? void 0 : _b2.unloadLock) === null || _c2 === void 0 ? void 0 : _c2.resolve();
          this.window.removeEventListener("unload", onWindowUnload, false);
        });
        if (win.document.readyState === "complete") {
          (_c = (_b = win.arguments[0]) === null || _b === void 0 ? void 0 : _b.loadLock) === null || _c === void 0 ? void 0 : _c.resolve();
        }
        return win;
      }
      function replaceElement(elementProps, uiTool) {
        var _a, _b, _c, _d, _e, _f, _g;
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
                  select === null || select === void 0 ? void 0 : select.blur();
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
                      var _a2;
                      const select = ev.target;
                      const dropdown = (_a2 = select.parentElement) === null || _a2 === void 0 ? void 0 : _a2.querySelector(".dropdown-content");
                      dropdown && (dropdown.style.display = "block");
                      select.setAttribute("focus", "true");
                    }
                  },
                  {
                    type: "blur",
                    listener: (ev) => {
                      var _a2;
                      const select = ev.target;
                      const dropdown = (_a2 = select.parentElement) === null || _a2 === void 0 ? void 0 : _a2.querySelector(".dropdown-content");
                      dropdown && (dropdown.style.display = "none");
                      select.removeAttribute("focus");
                    }
                  }
                ]
              }),
              {
                tag: "div",
                classList: ["dropdown-content"],
                children: (_a = elementProps.children) === null || _a === void 0 ? void 0 : _a.map((option) => {
                  var _a2, _b2, _c2;
                  return {
                    tag: "p",
                    attributes: {
                      value: (_a2 = option.properties) === null || _a2 === void 0 ? void 0 : _a2.value
                    },
                    properties: {
                      innerHTML: ((_b2 = option.properties) === null || _b2 === void 0 ? void 0 : _b2.innerHTML) || ((_c2 = option.properties) === null || _c2 === void 0 ? void 0 : _c2.innerText)
                    },
                    classList: ["dropdown-item"],
                    listeners: [
                      {
                        type: "click",
                        listener: (ev) => {
                          var _a3;
                          const select = (_a3 = ev.target.parentElement) === null || _a3 === void 0 ? void 0 : _a3.previousElementSibling;
                          select && (select.value = ev.target.getAttribute("value") || "");
                          select === null || select === void 0 ? void 0 : select.blur();
                        }
                      }
                    ]
                  };
                })
              }
            ]
          };
          for (const key in elementProps) {
            delete elementProps[key];
          }
          Object.assign(elementProps, customSelectProps);
        } else if (elementProps.tag === "a") {
          const href = ((_b = elementProps === null || elementProps === void 0 ? void 0 : elementProps.properties) === null || _b === void 0 ? void 0 : _b.href) || "";
          (_c = elementProps.properties) !== null && _c !== void 0 ? _c : elementProps.properties = {};
          elementProps.properties.href = "javascript:void(0);";
          (_d = elementProps.attributes) !== null && _d !== void 0 ? _d : elementProps.attributes = {};
          elementProps.attributes["zotero-href"] = href;
          (_e = elementProps.listeners) !== null && _e !== void 0 ? _e : elementProps.listeners = [];
          elementProps.listeners.push({
            type: "click",
            listener: (ev) => {
              var _a2;
              const href2 = (_a2 = ev.target) === null || _a2 === void 0 ? void 0 : _a2.getAttribute("zotero-href");
              href2 && uiTool.getGlobal("Zotero").launchURL(href2);
            }
          });
          (_f = elementProps.classList) !== null && _f !== void 0 ? _f : elementProps.classList = [];
          elementProps.classList.push("zotero-text-link");
        }
        if (checkChildren) {
          (_g = elementProps.children) === null || _g === void 0 ? void 0 : _g.forEach((child) => replaceElement(child, uiTool));
        }
      }
      var style = `
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
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/patch.js
  var require_patch = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/patch.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.PatchHelper = void 0;
      var basic_1 = require_basic();
      var PatchHelper = class extends basic_1.BasicTool {
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
      exports.PatchHelper = PatchHelper;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/fieldHook.js
  var require_fieldHook = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/fieldHook.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.FieldHookManager = void 0;
      var patch_1 = require_patch();
      var basic_1 = require_basic();
      var FieldHookManager = class extends basic_1.ManagerTool {
        constructor(base) {
          super(base);
          this.data = {
            getField: {},
            setField: {},
            isFieldOfBase: {}
          };
          this.patchHelpers = {
            getField: new patch_1.PatchHelper(),
            setField: new patch_1.PatchHelper(),
            isFieldOfBase: new patch_1.PatchHelper()
          };
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
      exports.FieldHookManager = FieldHookManager;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/largePref.js
  var require_largePref = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/largePref.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.LargePrefHelper = void 0;
      var basic_1 = require_basic();
      var LargePrefHelper = class extends basic_1.BasicTool {
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
            this.hooks = Object.assign(Object.assign({}, defaultHooks), hooks);
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
          let { value: newValue } = this.hooks.afterGetValue({ value });
          this.innerObj[key] = newValue;
          return newValue;
        }
        /**
         * Set the value of a key.
         * @param key The key of the data.
         * @param value The value of the key.
         */
        setValue(key, value) {
          let { key: newKey, value: newValue } = this.hooks.beforeSetValue({
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
      exports.LargePrefHelper = LargePrefHelper;
      var defaultHooks = {
        afterGetValue: ({ value }) => ({ value }),
        beforeSetValue: ({ key, value }) => ({ key, value })
      };
      var parserHooks = {
        afterGetValue: ({ value }) => {
          try {
            value = JSON.parse(value);
          } catch (e) {
            return { value };
          }
          return { value };
        },
        beforeSetValue: ({ key, value }) => {
          value = JSON.stringify(value);
          return { key, value };
        }
      };
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/keyboard.js
  var require_keyboard = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/managers/keyboard.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.KeyModifier = exports.KeyboardManager = void 0;
      var basic_1 = require_basic();
      var wait_1 = require_wait();
      var KeyboardManager = class extends basic_1.ManagerTool {
        constructor(base) {
          super(base);
          this._keyboardCallbacks = /* @__PURE__ */ new Set();
          this.initKeyboardListener = this._initKeyboardListener.bind(this);
          this.unInitKeyboardListener = this._unInitKeyboardListener.bind(this);
          this.triggerKeydown = (e) => {
            if (!this._cachedKey) {
              this._cachedKey = new KeyModifier(e);
            } else {
              this._cachedKey.merge(new KeyModifier(e), { allowOverwrite: false });
            }
            this.dispatchCallback(e, {
              type: "keydown"
            });
          };
          this.triggerKeyup = async (e) => {
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
          this.id = Zotero.Utilities.randomString();
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
        initReaderKeyboardListener() {
          Zotero.Reader.registerEventListener("renderToolbar", (event) => this.addReaderKeyboardCallback(event), this._basicOptions.api.pluginID);
          Zotero.Reader._readers.forEach((reader) => this.addReaderKeyboardCallback({ reader }));
        }
        async addReaderKeyboardCallback(event) {
          const reader = event.reader;
          let initializedKey = `_ztoolkitKeyboard${this.id}Initialized`;
          await (0, wait_1.waitForReader)(reader);
          if (!reader._iframeWindow) {
            return;
          }
          if (reader._iframeWindow[initializedKey]) {
            return;
          }
          this._initKeyboardListener(reader._iframeWindow);
          (0, wait_1.waitUntil)(() => {
            var _a, _b;
            return !Components.utils.isDeadWrapper(reader._internalReader) && ((_b = (_a = reader._internalReader) === null || _a === void 0 ? void 0 : _a._primaryView) === null || _b === void 0 ? void 0 : _b._iframeWindow);
          }, () => {
            var _a;
            return this._initKeyboardListener((_a = reader._internalReader._primaryView) === null || _a === void 0 ? void 0 : _a._iframeWindow);
          });
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
        dispatchCallback(...args) {
          this._keyboardCallbacks.forEach((cbk) => cbk(...args));
        }
      };
      exports.KeyboardManager = KeyboardManager;
      var KeyModifier = class {
        constructor(raw, options) {
          this.accel = false;
          this.shift = false;
          this.control = false;
          this.meta = false;
          this.alt = false;
          this.key = "";
          this.useAccel = false;
          this.useAccel = (options === null || options === void 0 ? void 0 : options.useAccel) || false;
          if (typeof raw === "undefined") {
            return;
          } else if (typeof raw === "string") {
            raw = raw || "";
            raw = this.unLocalized(raw);
            this.accel = raw.includes("accel");
            this.shift = raw.includes("shift");
            this.control = raw.includes("control");
            this.meta = raw.includes("meta");
            this.alt = raw.includes("alt");
            this.key = raw.replace(/(accel|shift|control|meta|alt| |,|-)/g, "").toLocaleLowerCase();
          } else if (raw instanceof KeyModifier) {
            this.merge(raw, { allowOverwrite: true });
          } else {
            if (options === null || options === void 0 ? void 0 : options.useAccel) {
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
         * @returns
         */
        merge(newMod, options) {
          const allowOverwrite = (options === null || options === void 0 ? void 0 : options.allowOverwrite) || false;
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
      exports.KeyModifier = KeyModifier;
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/guide.js
  var require_guide = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/helpers/guide.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.GuideHelper = void 0;
      var basic_1 = require_basic();
      var GuideHelper = class extends basic_1.BasicTool {
        constructor() {
          super();
          this._steps = [];
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
          if (!(doc === null || doc === void 0 ? void 0 : doc.ownerGlobal)) {
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
          if (!(doc === null || doc === void 0 ? void 0 : doc.ownerGlobal)) {
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
      exports.GuideHelper = GuideHelper;
      var Guide = class {
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
          if (!(step === null || step === void 0 ? void 0 : step.element))
            return void 0;
          let elem;
          if (typeof step.element === "function") {
            elem = step.element();
          } else if (typeof step.element === "string") {
            elem = document.querySelector(step.element);
          } else if (!step.element) {
            elem = document.documentElement;
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
          this._id = `guide-${Zotero.Utilities.randomString()}`;
          this._cachedMasks = [];
          this._centerPanel = () => {
            const win2 = this._window;
            this._panel.moveTo(win2.screenX + win2.innerWidth / 2 - this._panel.clientWidth / 2, win2.screenY + win2.innerHeight / 2 - this._panel.clientHeight / 2);
          };
          this._window = win;
          this._noClose = false;
          this._closed = false;
          this._autoNext = true;
          this._currentIndex = 0;
          const doc = win.document;
          let content = this.content;
          if (content) {
            doc.documentElement.append(doc.importNode(content, true));
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
            var _a;
            if ((_a = this.currentStep) === null || _a === void 0 ? void 0 : _a.onCloseClick) {
              await this.currentStep.onCloseClick(this.hookProps);
            }
            this.abort();
          });
          this._prevButton.addEventListener("click", async () => {
            var _a;
            if ((_a = this.currentStep) === null || _a === void 0 ? void 0 : _a.onPrevClick) {
              await this.currentStep.onPrevClick(this.hookProps);
            }
            this.movePrevious();
          });
          this._nextButton.addEventListener("click", async () => {
            var _a;
            if ((_a = this.currentStep) === null || _a === void 0 ? void 0 : _a.onNextClick) {
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
          let index = this._currentIndex;
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
          let x, y = 0;
          let position = step.position || "after_start";
          if (position === "center") {
            position = "overlap";
            x = window.innerWidth / 2;
            y = window.innerHeight / 2;
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
          if (showButtons === null || showButtons === void 0 ? void 0 : showButtons.length) {
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
        _createMask(targetElement) {
          const doc = (targetElement === null || targetElement === void 0 ? void 0 : targetElement.ownerDocument) || this._window.document;
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
          doc.documentElement.appendChild(svg);
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
    }
  });

  // node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/index.js
  var require_dist = __commonJS({
    "node_modules/.pnpm/zotero-plugin-toolkit@3.0.4/node_modules/zotero-plugin-toolkit/dist/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ZoteroToolkit = void 0;
      var basic_1 = require_basic();
      var ui_1 = require_ui();
      var reader_1 = require_reader();
      var extraField_1 = require_extraField();
      var prompt_1 = require_prompt();
      var menu_1 = require_menu();
      var clipboard_1 = require_clipboard();
      var filePicker_1 = require_filePicker();
      var progressWindow_1 = require_progressWindow();
      var virtualizedTable_1 = require_virtualizedTable();
      var dialog_1 = require_dialog();
      var fieldHook_1 = require_fieldHook();
      var largePref_1 = require_largePref();
      var keyboard_1 = require_keyboard();
      var patch_1 = require_patch();
      var guide_1 = require_guide();
      var ZoteroToolkit2 = class extends basic_1.BasicTool {
        constructor() {
          super();
          this.UI = new ui_1.UITool(this);
          this.Reader = new reader_1.ReaderTool(this);
          this.ExtraField = new extraField_1.ExtraFieldTool(this);
          this.FieldHooks = new fieldHook_1.FieldHookManager(this);
          this.Keyboard = new keyboard_1.KeyboardManager(this);
          this.Prompt = new prompt_1.PromptManager(this);
          this.Menu = new menu_1.MenuManager(this);
          this.Clipboard = (0, basic_1.makeHelperTool)(clipboard_1.ClipboardHelper, this);
          this.FilePicker = (0, basic_1.makeHelperTool)(filePicker_1.FilePickerHelper, this);
          this.Patch = (0, basic_1.makeHelperTool)(patch_1.PatchHelper, this);
          this.ProgressWindow = (0, basic_1.makeHelperTool)(progressWindow_1.ProgressWindowHelper, this);
          this.VirtualizedTable = (0, basic_1.makeHelperTool)(virtualizedTable_1.VirtualizedTableHelper, this);
          this.Dialog = (0, basic_1.makeHelperTool)(dialog_1.DialogHelper, this);
          this.LargePrefObject = (0, basic_1.makeHelperTool)(largePref_1.LargePrefHelper, this);
          this.Guide = (0, basic_1.makeHelperTool)(guide_1.GuideHelper, this);
        }
        /**
         * Unregister everything created by managers.
         */
        unregisterAll() {
          (0, basic_1.unregister)(this);
        }
      };
      exports.ZoteroToolkit = ZoteroToolkit2;
      exports.default = ZoteroToolkit2;
    }
  });

  // src/index.ts
  var import_basic = __toESM(require_basic());

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
  var SVGIcon = `<svg t="1748587495754" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1471" width="16" height="16"><path d="M942.2 486.2C847.4 286.5 704.1 186 512 186c-192.2 0-335.4 100.5-430.2 300.3-7.7 16.2-7.7 35.2 0 51.5C176.6 737.5 319.9 838 512 838c192.2 0 335.4-100.5 430.2-300.3 7.7-16.2 7.7-35 0-51.5zM512 766c-161.3 0-279.4-81.8-362.7-254C232.6 339.8 350.7 258 512 258c161.3 0 279.4 81.8 362.7 254C791.5 684.2 673.4 766 512 766z" p-id="1472"></path><path d="M508 336c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176z m0 288c-61.9 0-112-50.1-112-112s50.1-112 112-112 112 50.1 112 112-50.1 112-112 112z" p-id="1473"></path></svg>`;
  var Views = class {
    constructor() {
      this.view = "Annotation";
      this.registerButton();
      this.zoteroDir = Zotero.DataDirectory._dir;
      this.addonDir = PathUtils.join(this.zoteroDir, config.addonRef);
      this.dataDir = PathUtils.join(this.addonDir, "data");
      this.figureDir = PathUtils.join(this.addonDir, "figure");
      ztoolkit.UI.appendElement({
        tag: "div",
        styles: {
          backgroundImage: `url(chrome://${config.addonRef}/content/icons/favicon.png)`
        }
      }, document.lastChild);
      Zotero.Reader.registerEventListener(
        "renderSidebarAnnotationHeader",
        (event) => {
          const { reader, doc, params, append } = event;
          const annotationData = params.annotation;
          if (annotationData.type === "image" && annotationData.comment?.startsWith("[zoterofigure]")) {
            append(
              ztoolkit.UI.createElement(doc, "div", {
                classList: ["icon"],
                properties: {
                  innerHTML: SVGIcon,
                  title: "\u67E5\u770B\u56FE\u8868"
                },
                listeners: [
                  {
                    type: "click",
                    listener: (e) => {
                      const am = reader._internalReader._annotationManager;
                      const annos = am._annotations.filter(
                        (a) => a.type === "image" && a.comment?.startsWith("[zoterofigure]")
                      );
                      const srcs = annos.map((a) => a.image);
                      const index = annos.findIndex((a) => a.id === annotationData.id);
                      Zotero.BetterNotes?.hooks?.onShowImageViewer(srcs, index, "Figure");
                      e.preventDefault();
                    }
                  },
                  {
                    type: "mouseover",
                    listener: (e) => {
                      e.target.style.backgroundColor = "var(--color-sidepane)";
                    }
                  },
                  {
                    type: "mouseout",
                    listener: (e) => {
                      e.target.style.removeProperty("background-color");
                    }
                  }
                ],
                enableElementRecord: false,
                ignoreIfExists: true
              })
            );
          }
        },
        config.addonID
      );
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
      annos = annos.filter((a) => a.annotationType == "image" && a.annotationComment?.startsWith("[zoterofigure]"));
      annos = annos.map((a) => {
        a.annotationComment = a.annotationComment.replace("[zoterofigure]", "");
        return a;
      });
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
                          annos = annos.filter((a) => a.annotationType == "image" && a.annotationComment?.startsWith("[zoterofigure]"));
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
        <span style="background: url(chrome://${config.addonRef}/content/icons/favicon.png); background-size: 16px 16px; background-position: 35% center; background-repeat: no-repeat; display:block;width: 16px;height: 16px;margin-right: 5px;"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none"><path fill="currentColor" d="m0 2.707 4 4 4-4L7.293 2 4 5.293.707 2z"></path></svg>`
        }
      }, ref);
      if (reader._item.getAnnotations().find((i) => i.annotationComment?.startsWith("[zoterofigure]"))) {
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
          if (anno.comment?.startsWith("[zoterofigure]")) {
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
      if (!await IOUtils.exists(javaPath)) {
        window.alert("Java\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u914D\u7F6E\uFF0C\u8BF7\u53C2\u8003https://github.com/MuiseDestiny/zotero-figure\u914D\u7F6E");
        return [];
      }
      if (!await IOUtils.exists(jarPath)) {
        window.alert(`pdffigures2.jar\u4E0D\u5B58\u5728\uFF0C\u8BF7\u91CD\u65B0\u4E0B\u8F7D\uFF0C\u5E76\u79FB\u52A8\u5230 ${this.zoteroDir} \u4E0B\uFF0C\u8BF7\u53C2\u8003https://github.com/MuiseDestiny/zotero-figure\u4E0B\u8F7D`);
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
            ""
            // Empty tag since we're not using tags anymore
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
    annotation.comment = "[zoterofigure]" + (comment || "");
    annotation.tags = [];
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
        registerPrefsScripts(data.window);
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
  var import_zotero_plugin_toolkit = __toESM(require_dist());
  function createZToolkit() {
    const _ztoolkit = new import_zotero_plugin_toolkit.default();
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
  var basicTool = new import_basic.BasicTool();
  if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
    _globalThis.Zotero = basicTool.getGlobal("Zotero");
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
        return basicTool.getGlobal(name);
      }
    });
  }
})();
