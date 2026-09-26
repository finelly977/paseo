import { describe, expect, it } from "vitest";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import {
  buildLiveAgentModeDefinitions,
  resolveAgentControlsMode,
  resolveNextAgentModeId,
} from "./mode";

describe("buildLiveAgentModeDefinitions", () => {
  const runtimeCodexModes = [
    { id: "auto", label: "Default Permissions" },
    { id: "full-access", label: "Full Access" },
    { id: "custom", label: "自定义 (config.toml)" },
  ] satisfies AgentMode[];
  const catalogCodexModes = [
    { id: "auto", label: "Default Permissions", icon: "Shield", colorTier: "moderate" },
    { id: "full-access", label: "Full Access", icon: "ShieldOff", colorTier: "dangerous" },
    { id: "custom", label: "自定义 (config.toml)", icon: "ShieldPlus", colorTier: "moderate" },
  ] satisfies AgentMode[];

  it("gives a live session the same per-mode icons as the provider catalog", () => {
    const modes = buildLiveAgentModeDefinitions(runtimeCodexModes, catalogCodexModes);

    expect(modes.map((mode) => [mode.id, mode.icon, mode.colorTier])).toEqual([
      ["auto", "Shield", "moderate"],
      ["full-access", "ShieldOff", "dangerous"],
      ["custom", "ShieldPlus", "moderate"],
    ]);
  });

  it("keeps runtime-provided visuals over the catalog", () => {
    const modes = buildLiveAgentModeDefinitions(
      [{ id: "auto", label: "Auto", icon: "Bot", colorTier: "safe" }],
      catalogCodexModes,
    );

    expect(modes[0]).toMatchObject({ icon: "Bot", colorTier: "safe" });
  });

  it("falls back to the default shield while the catalog is not loaded", () => {
    const modes = buildLiveAgentModeDefinitions(runtimeCodexModes, undefined);

    expect(modes.every((mode) => mode.icon === "ShieldCheck")).toBe(true);
  });
});

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        onSelectProvider: () => undefined,
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});
