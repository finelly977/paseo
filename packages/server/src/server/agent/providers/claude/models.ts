import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  getClaudeManifestModels,
  normalizeClaudeRuntimeModelId as normalizeClaudeManifestRuntimeModelId,
  resolveClaudeDisabledThinkingForModel,
  CLAUDE_DISABLED_THINKING_OPTION_ID,
} from "./model-manifest.js";

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

interface ClaudeSettingsModelsInput {
  logger: Logger;
  knownModels: AgentModelDefinition[];
  configDir?: string;
}

interface AddSettingsModelInput {
  models: AgentModelDefinition[];
  value: unknown;
  settingsKey: string;
  knownModels: AgentModelDefinition[];
  configuredEffort: unknown;
}

export function getClaudeModels(claudeCodeVersion?: string): AgentModelDefinition[] {
  return getClaudeManifestModels(claudeCodeVersion);
}

export function findClaudeModel(
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  const normalizedModelId = normalizeClaudeRuntimeModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  return getClaudeModels().find((model) => model.id === normalizedModelId);
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir?: string,
  claudeCodeVersion?: string,
): Promise<AgentModelDefinition[]> {
  const hardcodedModels = getClaudeModels(claudeCodeVersion);
  const settingsModels = await readClaudeSettingsModels({
    logger,
    knownModels: hardcodedModels,
    configDir,
  });
  if (settingsModels.length === 0) {
    return hardcodedModels;
  }

  const seenModelIds = new Set(hardcodedModels.map((model) => model.id));
  const models = [...hardcodedModels];

  for (const model of settingsModels) {
    if (seenModelIds.has(model.id)) {
      continue;
    }
    seenModelIds.add(model.id);
    models.push(model);
  }

  return models;
}

async function readClaudeSettingsModels({
  logger,
  knownModels,
  configDir,
}: ClaudeSettingsModelsInput): Promise<AgentModelDefinition[]> {
  const settingsPath = path.join(resolveClaudeConfigDir(configDir), "settings.json");

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return [];
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return [];
  }

  const models: AgentModelDefinition[] = [];
  const configuredEffort = isRecord(parsed.env)
    ? (parsed.env.CLAUDE_CODE_EFFORT_LEVEL ?? parsed.effortLevel)
    : parsed.effortLevel;
  addSettingsModel({
    models,
    value: parsed.model,
    settingsKey: "model",
    knownModels,
    configuredEffort,
  });

  const env = parsed.env;
  if (env === undefined) {
    return models;
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return models;
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel({
      models,
      value: env[envKey],
      settingsKey: `env.${envKey}`,
      knownModels,
      configuredEffort,
    });
  }

  return models;
}

function resolveClaudeConfigDir(configDir?: string): string {
  return configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function addSettingsModel({
  models,
  value,
  settingsKey,
  knownModels,
  configuredEffort,
}: AddSettingsModelInput): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  const model: AgentModelDefinition = {
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  };
  const knownModelId = normalizeClaudeRuntimeModelId(id);
  const knownModel = knownModels.find((entry) => entry.id === knownModelId);
  if (knownModel?.thinkingOptions) {
    const supportsOff = resolveClaudeDisabledThinkingForModel(id).supported;
    model.thinkingOptions = knownModel.thinkingOptions.filter(
      (option) => supportsOff || option.id !== CLAUDE_DISABLED_THINKING_OPTION_ID,
    );
    const hasConfiguredEffort = model.thinkingOptions.some(
      (option) => option.id === configuredEffort,
    );
    model.defaultThinkingOptionId =
      hasConfiguredEffort && typeof configuredEffort === "string"
        ? configuredEffort
        : knownModel.defaultThinkingOptionId;
  }
  models.push(model);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  return normalizeClaudeManifestRuntimeModelId(value);
}
