import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import type {
  AgentModeColorTier,
  AgentProviderModeDefinition,
} from "@getpaseo/protocol/provider-manifest";

// Live sessions report runtime modes without visuals, while the provider catalog
// carries the manifest icon/colorTier. Borrow them by mode id so a running agent
// shows the same per-mode icons as the draft composer.
export function buildLiveAgentModeDefinitions(
  availableModes: readonly AgentMode[],
  catalogModes: readonly AgentMode[] | undefined,
): AgentProviderModeDefinition[] {
  return availableModes.map((mode): AgentProviderModeDefinition => {
    const catalogMode = catalogModes?.find((candidate) => candidate.id === mode.id);
    return {
      ...mode,
      icon: mode.icon ?? catalogMode?.icon ?? "ShieldCheck",
      colorTier: (mode.colorTier ?? catalogMode?.colorTier ?? "moderate") as AgentModeColorTier,
    };
  });
}

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
