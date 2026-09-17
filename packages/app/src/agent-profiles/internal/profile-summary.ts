import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { formatAgentModeLabel, formatThinkingOptionLabel } from "@/agent-controls/labels";

export interface AgentProfileTag {
  id: string;
  label: string;
}

function findEntry(
  entries: readonly ProviderSnapshotEntry[],
  provider: string,
): ProviderSnapshotEntry | null {
  return entries.find((entry) => entry.provider === provider) ?? null;
}

/**
 * A custom label wins. An unnamed profile follows its selected model so changing
 * the model also changes the label without writing a generated name to config.
 * Offline and retired catalog entries remain readable through their stored ids.
 */
export function resolveAgentProfileDisplayName(input: {
  profile: AgentProfile;
  entries: readonly ProviderSnapshotEntry[] | undefined;
}): string {
  const customName = input.profile.name.trim();
  if (customName) {
    return customName;
  }

  const entry = findEntry(input.entries ?? [], input.profile.provider);
  const modelId = input.profile.model?.trim();
  if (modelId) {
    return entry?.models?.find((candidate) => candidate.id === modelId)?.label.trim() || modelId;
  }

  const defaultModel =
    entry?.models?.find((candidate) => candidate.isDefault) ?? entry?.models?.[0];
  if (defaultModel) {
    return defaultModel.label.trim() || defaultModel.id;
  }

  return entry?.label?.trim() || input.profile.provider;
}

/**
 * The one-line résumé of a profile in the settings list. Every label falls back
 * to the stored id: a row must stay readable on a host whose provider catalog
 * is offline, or that no longer ships the model the profile names.
 */
export function buildAgentProfileTags(input: {
  profile: AgentProfile;
  entries: readonly ProviderSnapshotEntry[] | undefined;
  formatFeatureCount: (count: number) => string;
}): AgentProfileTag[] {
  const entries = input.entries ?? [];
  const entry = findEntry(entries, input.profile.provider);
  const tags: AgentProfileTag[] = [
    { id: "provider", label: entry?.label ?? input.profile.provider },
  ];

  const modelId = input.profile.model?.trim();
  if (modelId) {
    const model = entry?.models?.find((candidate) => candidate.id === modelId);
    tags.push({ id: "model", label: model?.label ?? modelId });
  }

  const modeId = input.profile.modeId?.trim();
  if (modeId) {
    const mode = entry?.modes?.find((candidate) => candidate.id === modeId);
    tags.push({ id: "mode", label: mode ? formatAgentModeLabel(mode) : modeId });
  }

  const thinkingOptionId = input.profile.thinkingOptionId?.trim();
  if (thinkingOptionId) {
    tags.push({ id: "thinking", label: formatThinkingOptionLabel({ id: thinkingOptionId }) });
  }

  const featureCount = Object.keys(input.profile.featureValues ?? {}).length;
  if (featureCount > 0) {
    tags.push({ id: "features", label: input.formatFeatureCount(featureCount) });
  }

  return tags;
}

/** Avoid repeating the model in the subtitle when it already supplies the title. */
export function buildAgentProfileSummaryTags(
  input: Parameters<typeof buildAgentProfileTags>[0],
): AgentProfileTag[] {
  const tags = buildAgentProfileTags(input);
  return input.profile.name.trim() ? tags : tags.filter((tag) => tag.id !== "model");
}
