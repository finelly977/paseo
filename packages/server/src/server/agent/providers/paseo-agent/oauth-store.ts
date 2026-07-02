import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import type {
  OAuthCredentials,
  OAuthDeviceCodeInfo as PiOAuthDeviceCodeInfo,
  OAuthLoginCallbacks,
  OAuthSelectPrompt,
} from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { PaseoAgentOAuthCredential } from "@getpaseo/protocol/messages";

// Paseo-owned OAuth credential store for the Paseo Agent provider. Credentials live
// in a Paseo-controlled file and are managed through Pi's own AuthStorage, so Pi
// refreshes tokens and persists rotation back into Paseo's file. Login flows reuse
// Pi's OAuth registry; Paseo does not reimplement OAuth protocols.

export type OAuthDeviceCodeInfo = PiOAuthDeviceCodeInfo;
type OAuthLogin = (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
type OAuthLoginPreference = "browser" | "device";

/** Path to the Paseo-owned auth store. Uses PASEO_HOME; falls back to ~/.paseo. */
export function paseoAgentAuthStoragePath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.PASEO_HOME ?? join(homedir(), ".paseo");
  return join(base, "paseo-agent", "auth.json");
}

/**
 * Pi AuthStorage backed by the Paseo-owned file. Pi creates the parent dir (0700) and
 * the file (0600) and re-chmods on every write, so refreshed tokens stay private.
 */
export function createPaseoAgentAuthStorage(env: NodeJS.ProcessEnv = process.env): AuthStorage {
  return AuthStorage.create(paseoAgentAuthStoragePath(env));
}

/**
 * Read-only check (no file creation) for whether a Paseo-owned OAuth credential exists
 * for a provider instance. Used for availability without constructing AuthStorage.
 */
export function hasStoredOAuthCredential(
  providerInstance: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const path = paseoAgentAuthStoragePath(env);
  if (!existsSync(path)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }
    const entry = (parsed as Record<string, unknown>)[providerInstance];
    return (
      typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "oauth"
    );
  } catch {
    return false;
  }
}

/**
 * Store a credential obtained by a remote-safe client-side OAuth flow into the
 * daemon's Paseo-owned AuthStorage. The caller supplies the protocol credential
 * shape, and this helper never reads or writes foreign auth files.
 */
export function storeOAuthCredential(options: {
  providerInstance: string;
  credential: PaseoAgentOAuthCredential;
  env?: NodeJS.ProcessEnv;
}): { path: string } {
  const path = paseoAgentAuthStoragePath(options.env);
  const authStorage = AuthStorage.create(path);
  authStorage.set(options.providerInstance, options.credential);
  return { path };
}

export async function loginAndStoreOAuth(options: {
  flow: string;
  providerInstance: string;
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  login?: OAuthLogin;
}): Promise<{ path: string }> {
  const login = resolveOAuthLogin(options.flow, options.login);
  const credentials = await login({
    onAuth: () => {},
    onDeviceCode: options.onDeviceCode,
    onPrompt: async () => {
      throw new Error("OAuth login requested manual input, but no prompt handler is available.");
    },
    onSelect: (prompt) => selectOAuthOption(prompt, "device"),
    signal: options.signal,
  });
  return storeOAuthCredential({
    providerInstance: options.providerInstance,
    credential: { type: "oauth", ...credentials },
    env: options.env,
  });
}

export async function loginOAuthBrowser(options: {
  flow: string;
  onAuthUrl: (url: string, instructions?: string) => void;
  promptForCode?: (message: string) => Promise<string>;
  onProgress?: (message: string) => void;
  login?: OAuthLogin;
}): Promise<PaseoAgentOAuthCredential> {
  const login = resolveOAuthLogin(options.flow, options.login);
  const credentials = await login({
    onAuth: (info) => options.onAuthUrl(info.url, info.instructions),
    onDeviceCode: () => {},
    onProgress: options.onProgress,
    onPrompt: async (prompt) => {
      if (!options.promptForCode) {
        throw new Error("Browser login did not complete and no manual code entry was available.");
      }
      return options.promptForCode(prompt.message);
    },
    onSelect: (prompt) => selectOAuthOption(prompt, "browser"),
  });
  return { type: "oauth", ...credentials };
}

function resolveOAuthLogin(flow: string, login: OAuthLogin | undefined): OAuthLogin {
  if (login) {
    return login;
  }
  const provider = getOAuthProvider(flow);
  if (!provider) {
    throw new Error(`Paseo Agent: OAuth flow "${flow}" is not registered by Pi.`);
  }
  return (callbacks) => provider.login(callbacks);
}

function selectOAuthOption(
  prompt: OAuthSelectPrompt,
  preference: OAuthLoginPreference,
): Promise<string | undefined> {
  const preferred = prompt.options.find((option) =>
    option.label.toLowerCase().includes(preference),
  );
  return Promise.resolve((preferred ?? prompt.options[0])?.id);
}
