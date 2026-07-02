import { z } from "zod";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  isRefreshTokenExpressionConfigured,
  resolveRefreshTokenExpression,
} from "./oauth-credentials.js";
import type { PaseoAgentModelProvider, PaseoAgentModelReference } from "./pi-services.js";
import {
  requirePaseoAgentCatalogEntry,
  type PaseoAgentCatalogEntry,
  type PaseoAgentCatalogModel,
} from "./catalog.js";
import { findEnvReferences } from "./env-references.js";

export const PASEO_AGENT_PROVIDER = "paseo";

const PaseoAgentModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    reasoning: z.boolean().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

const PaseoAgentProviderOptionsSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    api: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    authHeader: z.boolean().optional(),
    refreshToken: z.string().min(1).optional(),
    models: z.array(PaseoAgentModelSchema).min(1).optional(),
  })
  .strict();

const PaseoAgentModelProviderSchema = z
  .object({
    type: z.string().min(1),
    options: PaseoAgentProviderOptionsSchema.default({}),
  })
  .strict();

export const PaseoAgentConfigSchema = z
  .object({
    defaultModel: z.string().min(1).optional(),
    defaultAgent: z.string().min(1).optional(),
    defaultProfile: z.string().min(1).optional(),
    providers: z.record(z.string(), PaseoAgentModelProviderSchema).optional(),
  })
  .strict();

export type PaseoAgentConfig = z.infer<typeof PaseoAgentConfigSchema>;
export type PaseoAgentModelProviderEntry = z.infer<typeof PaseoAgentModelProviderSchema>;
type PiModelConfig = NonNullable<PaseoAgentModelProvider["config"]["models"]>[number];

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

export interface ResolvedProviderSettings {
  baseUrl: string;
  api: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

function entries(config: PaseoAgentConfig): [string, PaseoAgentModelProviderEntry][] {
  return Object.entries(config.providers ?? {});
}

function mergeHeaders(
  catalogHeaders: Record<string, string> | undefined,
  optionHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const headers = { ...catalogHeaders, ...optionHeaders };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function resolvePaseoAgentProviderSettings(
  entry: PaseoAgentModelProviderEntry,
  catalogEntry: PaseoAgentCatalogEntry = requirePaseoAgentCatalogEntry(entry.type),
): ResolvedProviderSettings {
  const apiKey =
    catalogEntry.auth.kind === "api_key"
      ? (entry.options.apiKey ?? `$${catalogEntry.auth.envVar}`)
      : undefined;
  const headers = mergeHeaders(catalogEntry.headers, entry.options.headers);
  return {
    baseUrl: entry.options.baseUrl ?? catalogEntry.baseUrl,
    api: entry.options.api ?? catalogEntry.api,
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    ...(entry.options.authHeader ? { authHeader: entry.options.authHeader } : {}),
  };
}

export function resolvePaseoAgentProviderModels(
  entry: PaseoAgentModelProviderEntry,
  catalogEntry: PaseoAgentCatalogEntry = requirePaseoAgentCatalogEntry(entry.type),
): PaseoAgentCatalogModel[] {
  return entry.options.models ?? catalogEntry.models;
}

/**
 * Whether a resolved API-key value is actually configured. Mirrors Pi's config-value
 * semantics without importing Pi: literals and `!command` values count as present;
 * `$ENV` / `${ENV}` references count only when every referenced var is set.
 */
function isAuthConfigured(value: string | undefined, env: NodeJS.ProcessEnv): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith("!")) {
    return true;
  }
  const referencedVars = findEnvReferences(value);
  if (referencedVars.length === 0) {
    return true;
  }
  return referencedVars.every((name) => Boolean(env[name]));
}

export function encodePaseoAgentModelId(providerName: string, modelId: string): string {
  return `${providerName}/${modelId}`;
}

export function parsePaseoAgentModelId(modelId: string): PaseoAgentModelReference | null {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    return null;
  }
  return { provider: modelId.slice(0, slash), id: modelId.slice(slash + 1) };
}

function toPiModels(
  entry: PaseoAgentModelProviderEntry,
  settings: ResolvedProviderSettings,
): PiModelConfig[] {
  const catalogEntry = requirePaseoAgentCatalogEntry(entry.type);
  return resolvePaseoAgentProviderModels(entry, catalogEntry).map((model) => {
    const api = model.api ?? settings.api;
    const piModel: PiModelConfig = {
      id: model.id,
      name: model.label ?? model.id,
      reasoning: model.reasoning ?? false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (api) {
      piModel.api = api;
    }
    return piModel;
  });
}

export async function paseoAgentModelProviders(
  config: PaseoAgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PaseoAgentModelProvider[]> {
  const providers: PaseoAgentModelProvider[] = [];

  for (const [name, entry] of entries(config)) {
    const catalogEntry = requirePaseoAgentCatalogEntry(entry.type);
    const settings = resolvePaseoAgentProviderSettings(entry, catalogEntry);
    const models = toPiModels(entry, settings);

    if (catalogEntry.auth.kind === "oauth") {
      const refreshToken = entry.options.refreshToken
        ? await resolveRefreshTokenExpression(entry.options.refreshToken, env)
        : undefined;
      providers.push({
        name,
        config: {
          baseUrl: settings.baseUrl,
          api: settings.api,
          ...(settings.headers ? { headers: settings.headers } : {}),
          models,
        },
        oauth: { flow: catalogEntry.auth.flow, ...(refreshToken ? { refreshToken } : {}) },
      });
      continue;
    }

    providers.push({
      name,
      config: {
        baseUrl: settings.baseUrl,
        ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
        api: settings.api,
        ...(settings.headers ? { headers: settings.headers } : {}),
        ...(settings.authHeader ? { authHeader: settings.authHeader } : {}),
        models,
      },
    });
  }

  return providers;
}

export function listPaseoAgentModels(config: PaseoAgentConfig): AgentModelDefinition[] {
  const models: AgentModelDefinition[] = [];
  for (const [name, entry] of entries(config)) {
    const catalogEntry = requirePaseoAgentCatalogEntry(entry.type);
    for (const model of resolvePaseoAgentProviderModels(entry, catalogEntry)) {
      const id = encodePaseoAgentModelId(name, model.id);
      models.push({
        provider: PASEO_AGENT_PROVIDER,
        id,
        label: model.label ?? model.id,
        description: `${name} - ${model.id}`,
        isDefault: config.defaultModel === id,
      });
    }
  }
  return models;
}

export function paseoAgentHasUsableModel(
  config: PaseoAgentConfig,
  env: NodeJS.ProcessEnv = process.env,
  isOAuthAuthed: (providerInstance: string) => boolean = () => false,
): boolean {
  return entries(config).some(([name, entry]) => {
    const catalogEntry = requirePaseoAgentCatalogEntry(entry.type);
    if (resolvePaseoAgentProviderModels(entry, catalogEntry).length === 0) {
      return false;
    }
    if (catalogEntry.auth.kind === "oauth") {
      if (
        entry.options.refreshToken &&
        isRefreshTokenExpressionConfigured(entry.options.refreshToken, env)
      ) {
        return true;
      }
      return isOAuthAuthed(name);
    }
    return isAuthConfigured(resolvePaseoAgentProviderSettings(entry, catalogEntry).apiKey, env);
  });
}

export function resolvePaseoAgentModel(
  config: PaseoAgentConfig,
  requestedModelId: string | null | undefined,
  registeredProviders: PaseoAgentModelProvider[] = paseoAgentModelInventory(config),
  agentDefaultModelId?: string | null,
): PaseoAgentModelReference | undefined {
  if (requestedModelId) {
    return parsePaseoAgentModelId(requestedModelId) ?? undefined;
  }

  for (const candidate of [agentDefaultModelId, config.defaultModel, firstModelId(config)]) {
    if (!candidate) {
      continue;
    }
    const parsed = parsePaseoAgentModelId(candidate);
    if (parsed && hasRegisteredModel(registeredProviders, parsed)) {
      return parsed;
    }
  }

  return firstRegisteredModel(registeredProviders);
}

function paseoAgentModelInventory(config: PaseoAgentConfig): PaseoAgentModelProvider[] {
  return entries(config).map(([name, entry]) => {
    const settings = resolvePaseoAgentProviderSettings(entry);
    return { name, config: { models: toPiModels(entry, settings) } };
  });
}

function firstModelId(config: PaseoAgentConfig): string | undefined {
  for (const [name, entry] of entries(config)) {
    const catalogEntry = requirePaseoAgentCatalogEntry(entry.type);
    const first = resolvePaseoAgentProviderModels(entry, catalogEntry)[0];
    if (first) {
      return encodePaseoAgentModelId(name, first.id);
    }
  }
  return undefined;
}

function hasRegisteredModel(
  providers: PaseoAgentModelProvider[],
  model: PaseoAgentModelReference,
): boolean {
  return providers.some(
    (provider) =>
      provider.name === model.provider &&
      provider.config.models?.some((registered) => registered.id === model.id),
  );
}

function firstRegisteredModel(
  providers: PaseoAgentModelProvider[],
): PaseoAgentModelReference | undefined {
  for (const provider of providers) {
    const first = provider.config.models?.[0];
    if (first) {
      return { provider: provider.name, id: first.id };
    }
  }
  return undefined;
}
