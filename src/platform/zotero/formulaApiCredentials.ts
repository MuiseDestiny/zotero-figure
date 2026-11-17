import { clearPref, getPref } from "../../utils/prefs";

type FormulaApiProvider = "custom" | "siliconflow";
const CREDENTIAL_ORIGIN = "chrome://zoterofigure";
const CREDENTIAL_REALM = "Formula OCR API";
let operations: Promise<void> = Promise.resolve();

// Keep Gecko login-manager version differences at this boundary.
interface FormulaLogin {
  password: string;
  username: string;
  init(
    origin: string,
    actionOrigin: null,
    realm: string,
    username: string,
    password: string,
    usernameField: string,
    passwordField: string,
  ): void;
}

interface FormulaLoginManager {
  initializationPromise: Promise<unknown>;
  addLoginAsync(login: FormulaLogin): Promise<unknown>;
  searchLoginsAsync(match: {
    origin: string;
    httpRealm: string;
  }): Promise<FormulaLogin[]>;
  modifyLogin?(previous: FormulaLogin, updated: FormulaLogin): void;
  modifyLoginAsync?(
    previous: FormulaLogin,
    updated: FormulaLogin,
  ): Promise<void>;
  removeLogin?(login: FormulaLogin): void;
  removeLoginAsync?(login: FormulaLogin): Promise<void>;
}

export function getFormulaApiKey(
  provider: FormulaApiProvider,
): Promise<string> {
  return enqueue(async () => {
    const manager = await getLoginManager();
    const existing = await findCredential(manager, provider);
    const legacyKey = getPref(legacyKeyPreference(provider));
    if (existing) {
      clearPref(legacyKeyPreference(provider));
      return existing.password;
    }
    if (!legacyKey) return "";
    // Remove the old plaintext preference only after secure storage succeeds.
    await writeCredential(manager, provider, legacyKey);
    clearPref(legacyKeyPreference(provider));
    return legacyKey.trim();
  });
}

export function saveFormulaApiKey(
  provider: FormulaApiProvider,
  value: string,
): Promise<void> {
  return enqueue(async () => {
    await writeCredential(await getLoginManager(), provider, value);
    clearPref(legacyKeyPreference(provider));
  });
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = operations.then(operation);
  // Callers receive failures; a failed operation must not block later retries.
  operations = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function getLoginManager(): Promise<FormulaLoginManager> {
  const manager = Services.logins as unknown as FormulaLoginManager;
  await manager.initializationPromise;
  return manager;
}

async function writeCredential(
  manager: FormulaLoginManager,
  provider: FormulaApiProvider,
  value: string,
): Promise<void> {
  const existing = await findCredential(manager, provider);
  const key = value.trim();
  if (existing?.password === key) return;
  if (!key) {
    if (existing) {
      if (manager.removeLoginAsync) await manager.removeLoginAsync(existing);
      else if (manager.removeLogin) manager.removeLogin(existing);
      else throw new Error("Login manager cannot remove credentials");
    }
    return;
  }
  const factories = Components.classes as unknown as Record<
    string,
    { createInstance(iid: unknown): FormulaLogin }
  >;
  const login = factories[
    "@mozilla.org/login-manager/loginInfo;1"
  ].createInstance(Components.interfaces.nsILoginInfo);
  login.init(CREDENTIAL_ORIGIN, null, CREDENTIAL_REALM, provider, key, "", "");
  if (!existing) await manager.addLoginAsync(login);
  else if (manager.modifyLoginAsync)
    await manager.modifyLoginAsync(existing, login);
  else if (manager.modifyLogin) manager.modifyLogin(existing, login);
  else throw new Error("Login manager cannot update credentials");
}

async function findCredential(
  manager: FormulaLoginManager,
  provider: FormulaApiProvider,
): Promise<FormulaLogin | undefined> {
  const logins = await manager.searchLoginsAsync({
    origin: CREDENTIAL_ORIGIN,
    httpRealm: CREDENTIAL_REALM,
  });
  return logins.find(({ username }) => username === provider);
}

function legacyKeyPreference(provider: FormulaApiProvider) {
  return provider === "custom" ? "customFormulaApiKey" : "siliconFlowApiKey";
}
