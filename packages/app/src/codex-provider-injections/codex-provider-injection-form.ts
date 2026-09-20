import {
  getCodexProviderInjectionModels,
  type CodexProviderInjection,
} from "@getpaseo/protocol/messages";

export type OptionalBooleanDraft = "default" | "enabled" | "disabled";

export interface CodexProviderDefinitionDraft {
  providerName: string;
  baseUrl: string;
  envKey: string;
  requiresOpenAiAuth: OptionalBooleanDraft;
  supportsWebsockets: OptionalBooleanDraft;
  additionalDefinition: Record<string, unknown>;
}

export interface EnvironmentVariableInput {
  key: string;
  value: string;
}

export interface CodexProviderInjectionFormDraft {
  name: string;
  modelProvider: string;
  models: string[];
  providerName: string;
  baseUrl: string;
  envKey: string;
  requiresOpenAiAuth: OptionalBooleanDraft;
  supportsWebsockets: OptionalBooleanDraft;
  environmentVariables: EnvironmentVariableInput[];
  additionalDefinition: string;
  advancedOpen: boolean;
}

export interface OpenCodexProviderInjectionFormResult {
  draft: CodexProviderInjectionFormDraft;
  error: Error | null;
}

const KNOWN_PROVIDER_DEFINITION_KEYS = new Set([
  "name",
  "base_url",
  "wire_api",
  "env_key",
  "requires_openai_auth",
  "supports_websockets",
]);

function readOptionalString(definition: Record<string, unknown>, key: string): string {
  const value = definition[key];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error(`服务商定义中的 ${key} 必须是字符串`);
  }
  return value;
}

function readOptionalBoolean(
  definition: Record<string, unknown>,
  key: string,
): OptionalBooleanDraft {
  const value = definition[key];
  if (value === undefined) return "default";
  if (typeof value !== "boolean") {
    throw new Error(`服务商定义中的 ${key} 必须是布尔值`);
  }
  return value ? "enabled" : "disabled";
}

export function parseCodexProviderDefinition(
  definition: Record<string, unknown>,
): CodexProviderDefinitionDraft {
  return {
    providerName: readOptionalString(definition, "name"),
    baseUrl: readOptionalString(definition, "base_url"),
    envKey: readOptionalString(definition, "env_key"),
    requiresOpenAiAuth: readOptionalBoolean(definition, "requires_openai_auth"),
    supportsWebsockets: readOptionalBoolean(definition, "supports_websockets"),
    additionalDefinition: Object.fromEntries(
      Object.entries(definition).filter(([key]) => !KNOWN_PROVIDER_DEFINITION_KEYS.has(key)),
    ),
  };
}

function createBaseFormDraft(injection?: CodexProviderInjection): CodexProviderInjectionFormDraft {
  const configuredModels = injection ? getCodexProviderInjectionModels(injection) : [];
  return {
    name: injection?.name ?? "",
    modelProvider: injection?.modelProvider ?? "",
    models: configuredModels.length ? [...configuredModels] : [""],
    providerName: "",
    baseUrl: "",
    envKey: "",
    requiresOpenAiAuth: "default",
    supportsWebsockets: "default",
    environmentVariables: injection?.env
      ? Object.entries(injection.env).map(([key, value]) => ({ key, value }))
      : [{ key: "", value: "" }],
    additionalDefinition: "{}",
    advancedOpen: false,
  };
}

export function openCodexProviderInjectionForm(
  injection?: CodexProviderInjection,
): OpenCodexProviderInjectionFormResult {
  const draft = createBaseFormDraft(injection);
  if (!injection) return { draft, error: null };

  try {
    const definition = parseCodexProviderDefinition(injection.definition);
    return {
      draft: {
        ...draft,
        providerName: definition.providerName,
        baseUrl: definition.baseUrl,
        envKey: definition.envKey,
        requiresOpenAiAuth: definition.requiresOpenAiAuth,
        supportsWebsockets: definition.supportsWebsockets,
        additionalDefinition: JSON.stringify(definition.additionalDefinition, null, 2),
        advancedOpen:
          Object.keys(definition.additionalDefinition).length > 0 ||
          Boolean(definition.providerName && definition.providerName !== injection.name),
      },
      error: null,
    };
  } catch (error) {
    return {
      draft: {
        ...draft,
        additionalDefinition: JSON.stringify(injection.definition, null, 2),
        advancedOpen: true,
      },
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function optionalBooleanValue(value: OptionalBooleanDraft): boolean | undefined {
  if (value === "default") return undefined;
  return value === "enabled";
}

export function buildCodexProviderDefinition(input: {
  displayName: string;
  providerName: string;
  baseUrl: string;
  envKey: string;
  requiresOpenAiAuth: OptionalBooleanDraft;
  supportsWebsockets: OptionalBooleanDraft;
  additionalDefinition: Record<string, unknown>;
}): Record<string, unknown> {
  for (const key of Object.keys(input.additionalDefinition)) {
    if (KNOWN_PROVIDER_DEFINITION_KEYS.has(key) || key === "model_provider") {
      throw new Error(`其他服务商参数中不要重复填写 ${key}`);
    }
  }

  const openAiAuth = optionalBooleanValue(input.requiresOpenAiAuth);
  const websockets = optionalBooleanValue(input.supportsWebsockets);
  return {
    ...input.additionalDefinition,
    name: input.providerName.trim() || input.displayName.trim(),
    ...(input.baseUrl.trim() ? { base_url: input.baseUrl.trim() } : {}),
    wire_api: "responses",
    ...(input.envKey.trim() ? { env_key: input.envKey.trim() } : {}),
    ...(openAiAuth === undefined ? {} : { requires_openai_auth: openAiAuth }),
    ...(websockets === undefined ? {} : { supports_websockets: websockets }),
  };
}

export function buildEnvironmentVariables(
  drafts: readonly EnvironmentVariableInput[],
): Record<string, string> | undefined {
  const entries: [string, string][] = [];
  const seenKeys = new Set<string>();
  for (const draft of drafts) {
    const key = draft.key.trim();
    const value = draft.value;
    if (!key && !value) continue;
    if (!key || !value) {
      throw new Error("环境变量名称和值必须同时填写");
    }
    if (seenKeys.has(key)) {
      throw new Error(`环境变量名称不能重复：${key}`);
    }
    seenKeys.add(key);
    entries.push([key, value]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}
