import type { AgentFeature, AgentFeatureToggle } from "../agent-sdk-types.js";
import { z } from "zod";

export const CodexServiceTierSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
});

type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

export const CODEX_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "使用当前模型支持的快速处理档位",
  tooltip: "切换快速模式",
  icon: "zap",
};

export const CODEX_PLAN_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "plan_mode",
  label: "Plan",
  description: "Switch Codex into planning-only collaboration mode",
  tooltip: "Toggle plan mode",
  icon: "list-todo",
};

export function normalizeCodexServiceTier(serviceTier: string | null | undefined): string | null {
  if (serviceTier === "fast") return "priority";
  return serviceTier ?? null;
}

export function resolveCodexFastServiceTier(
  serviceTiers: readonly CodexServiceTier[],
): string | null {
  const fastTier = serviceTiers.find(
    (tier) => tier.name.toLowerCase() === "fast" || tier.id === "priority" || tier.id === "fast",
  );
  return normalizeCodexServiceTier(fastTier?.id);
}

export function resolveCodexServiceTier(input: {
  fastModePreference: boolean | undefined;
  fastServiceTierId: string | null;
  configuredServiceTier: string | null;
  defaultServiceTier: string | null;
}): string | null {
  if (input.fastModePreference === false) return "default";
  if (input.fastModePreference === true) return input.fastServiceTierId ?? "default";
  const selectedTier = input.configuredServiceTier ?? input.defaultServiceTier;
  const serviceTier = normalizeCodexServiceTier(selectedTier);
  if (serviceTier === "priority" && input.fastServiceTierId === null) return "default";
  return serviceTier;
}

export function buildCodexFeatures(input: {
  fastServiceTierId: string | null;
  fastModeEnabled: boolean;
  planModeEnabled: boolean;
  planModeAvailable?: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [];

  if (input.fastServiceTierId !== null) {
    features.push({
      ...CODEX_FAST_MODE_FEATURE,
      value: input.fastModeEnabled,
    });
  }

  if (input.planModeAvailable !== false) {
    features.push({
      ...CODEX_PLAN_MODE_FEATURE,
      value: input.planModeEnabled,
    });
  }

  return features;
}
