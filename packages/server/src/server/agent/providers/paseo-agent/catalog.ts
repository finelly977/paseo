export interface PaseoAgentCatalogModel {
  id: string;
  label?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface PaseoAgentApiKeyAuth {
  kind: "api_key";
  envVar: string;
  keyUrl?: string;
  placeholder?: string;
  hint?: string;
}

export interface PaseoAgentOAuthAuth {
  kind: "oauth";
  flow: string;
}

export type PaseoAgentCatalogAuth = PaseoAgentApiKeyAuth | PaseoAgentOAuthAuth;

export interface PaseoAgentCatalogEntry {
  id: string;
  label: string;
  iconName?: string;
  docsUrl?: string;
  api: string;
  baseUrl: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  auth: PaseoAgentCatalogAuth;
  models: PaseoAgentCatalogModel[];
}

export const PASEO_AGENT_PROVIDER_CATALOG = [
  {
    id: "openrouter",
    label: "OpenRouter",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: { kind: "api_key", envVar: "OPENROUTER_API_KEY" },
    models: [],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    iconName: "openai",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    auth: { kind: "oauth", flow: "openai-codex" },
    models: [{ id: "gpt-5.3-codex", reasoning: true }],
  },
  {
    id: "kimi",
    label: "Kimi Coding Plan",
    api: "anthropic-messages",
    baseUrl: "https://api.kimi.com/coding",
    headers: { "User-Agent": "KimiCLI/1.5" },
    auth: { kind: "api_key", envVar: "KIMI_API_KEY" },
    models: [],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/go/v1",
    auth: { kind: "api_key", envVar: "OPENCODE_API_KEY" },
    models: [],
  },
] as const satisfies readonly PaseoAgentCatalogEntry[];

const PASEO_AGENT_PROVIDER_ALIASES: Record<string, string> = {
  "openai-codex": "chatgpt",
};

export function resolvePaseoAgentCatalogEntry(
  providerType: string,
): PaseoAgentCatalogEntry | undefined {
  const canonicalId = PASEO_AGENT_PROVIDER_ALIASES[providerType] ?? providerType;
  return PASEO_AGENT_PROVIDER_CATALOG.find((entry) => entry.id === canonicalId);
}

export function knownPaseoAgentCatalogIds(): string[] {
  return PASEO_AGENT_PROVIDER_CATALOG.map((entry) => entry.id);
}

export function unknownPaseoAgentProviderTypeMessage(providerType: string): string {
  return `Unknown model provider type "${providerType}". Known provider ids: ${knownPaseoAgentCatalogIds().join(", ")}. Update the host if this provider is newer than it.`;
}

export function requirePaseoAgentCatalogEntry(providerType: string): PaseoAgentCatalogEntry {
  const entry = resolvePaseoAgentCatalogEntry(providerType);
  if (!entry) {
    throw new Error(unknownPaseoAgentProviderTypeMessage(providerType));
  }
  return entry;
}
