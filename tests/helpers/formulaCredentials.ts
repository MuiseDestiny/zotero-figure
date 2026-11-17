export function installFormulaCredentialsHarness(asyncOnly = false) {
  const globals = globalThis as any;
  const previous = {
    Components: globals.Components,
    Services: globals.Services,
    Zotero: globals.Zotero,
  };
  const prefs = new Map<string, unknown>();
  const logins: Login[] = [];
  let failSave = false;
  let adds = 0;
  class Login {
    public origin = "";
    public realm = "";
    public username = "";
    public password = "";
    public init(
      origin: string,
      actionOrigin: null,
      realm: string,
      username: string,
      password: string,
    ): void {
      if (actionOrigin !== null)
        throw new Error("HTTP realm needs null action");
      Object.assign(this, { origin, password, realm, username });
    }
  }
  globals.Components = {
    classes: {
      "@mozilla.org/login-manager/loginInfo;1": {
        createInstance: () => new Login(),
      },
    },
    interfaces: { nsILoginInfo: {} },
  };
  globals.Services = {
    logins: {
      initializationPromise: Promise.resolve(),
      addLoginAsync: async (login: Login) => {
        if (failSave) throw new Error("storage unavailable");
        adds++;
        logins.push(login);
      },
      searchLoginsAsync: async ({
        origin,
        httpRealm: realm,
      }: {
        origin: string;
        httpRealm: string;
      }) => {
        return logins.filter(
          (login) => login.origin === origin && login.realm === realm,
        );
      },
      modifyLogin: (old: Login, updated: Login) => {
        if (failSave) throw new Error("storage unavailable");
        logins.splice(logins.indexOf(old), 1, updated);
      },
      removeLogin: (login: Login) => logins.splice(logins.indexOf(login), 1),
    },
  };
  if (asyncOnly) {
    const manager = globals.Services.logins;
    manager.modifyLoginAsync = async (old: Login, updated: Login) => {
      if (failSave) throw new Error("storage unavailable");
      logins.splice(logins.indexOf(old), 1, updated);
    };
    manager.removeLoginAsync = async (login: Login) => {
      logins.splice(logins.indexOf(login), 1);
    };
    delete manager.modifyLogin;
    delete manager.removeLogin;
  }
  globals.Zotero = {
    Prefs: {
      clear: (key: string) => prefs.delete(key),
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => {
        if (key.endsWith("ApiKey"))
          throw new Error("must not store keys in Prefs");
        prefs.set(key, value);
      },
    },
  };
  return {
    get adds() {
      return adds;
    },
    failSave(value: boolean) {
      failSave = value;
    },
    logins,
    prefs,
    restore() {
      Object.assign(globals, previous);
    },
  };
}
