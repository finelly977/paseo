import { describe, expect, it } from "vitest";
import {
  formatAgentModeLabel,
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  formatThinkingOptionLabel,
  normalizeModelId,
  resolveAgentModelSelection,
  sortThinkingOptions,
} from "./utils";

describe("getAgentControlHintKey", () => {
  it("returns translation keys for each editable agent control hint", () => {
    expect(getAgentControlHintKey("thinking")).toBe("agentControls.hints.thinking");
    expect(getAgentControlHintKey("model")).toBe("agentControls.hints.model");
    expect(getAgentControlHintKey("mode")).toBe("agentControls.hints.mode");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });
});

describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("formatAgentModeLabel", () => {
  it("sentence-cases provider mode labels", () => {
    expect(formatAgentModeLabel({ id: "plan", label: "Plan" })).toBe("Plan");
    expect(formatAgentModeLabel({ id: "full-access", label: "Full Access" })).toBe("Full access");
    expect(formatAgentModeLabel({ id: "auto-review", label: "Auto-review" })).toBe("Auto-review");
    expect(formatAgentModeLabel({ id: "read_only", label: "read_only" })).toBe("Read only");
    expect(formatAgentModeLabel({ id: "acceptEdits", label: "acceptEdits" })).toBe("Accept edits");
  });

  it("splits compact mode ids when no provider label is available", () => {
    expect(formatAgentModeLabel({ id: "auto-review" })).toBe("Auto review");
  });
});

describe("formatThinkingOptionLabel", () => {
  it("formats compact thinking option labels for display", () => {
    expect(formatThinkingOptionLabel({ id: "none", label: "none" })).toBe("None");
    expect(formatThinkingOptionLabel({ id: "low", label: "low" })).toBe("Low");
    expect(formatThinkingOptionLabel({ id: "medium", label: "medium" })).toBe("Medium");
    expect(formatThinkingOptionLabel({ id: "high", label: "high" })).toBe("High");
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "xhigh" })).toBe("Extra high");
  });

  it("sentence-cases split provider labels", () => {
    expect(formatThinkingOptionLabel({ id: "extra_high", label: "extra_high" })).toBe("Extra high");
    expect(formatThinkingOptionLabel({ id: "think-hard", label: "think-hard" })).toBe("Think hard");
    expect(formatThinkingOptionLabel({ id: "xhigh", label: "XHigh" })).toBe("Extra high");
  });
});

describe("resolveAgentModelSelection", () => {
  it("prefers runtime model over configured model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("a");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("Extra high");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("Low");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("Low");
  });

  it("保留注入服务商的自定义模型，不回退显示原服务商默认模型", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "gpt-default",
          provider: "codex",
          label: "GPT Default",
          isDefault: true,
        },
      ],
      runtimeModelId: "proxy-codex-model",
      configuredModelId: "proxy-codex-model",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("proxy-codex-model");
    expect(selection.displayModel).toBe("proxy-codex-model");
  });

  it("按由浅入深规范排序思考强度选项，确保 Max 在 Extra high 与 Ultra code 之后", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "claude-opus-5",
          provider: "claude",
          label: "Opus 5",
          thinkingOptions: [
            { id: "max", label: "Max" },
            { id: "high", label: "High" },
            { id: "ultracode", label: "Ultra code" },
            { id: "low", label: "Low" },
            { id: "xhigh", label: "Extra high" },
            { id: "medium", label: "Medium" },
            { id: "off", label: "Off" },
          ],
          defaultThinkingOptionId: "high",
        },
      ],
      runtimeModelId: "claude-opus-5",
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.thinkingOptions?.map((option) => option.id)).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(selection.selectedThinkingId).toBe("high");
  });
});

describe("sortThinkingOptions", () => {
  it("将乱序的通用思考档位规范为从浅到深并保持 Max 居末", () => {
    expect(
      sortThinkingOptions([
        { id: "max", label: "Max" },
        { id: "xhigh", label: "Extra high" },
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
        { id: "medium", label: "Medium" },
      ]).map((option) => option.id),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("保留 default/minimal 靠前以及未知自定义档位在 Max 之前的相对顺序", () => {
    expect(
      sortThinkingOptions([
        { id: "max", label: "Max" },
        { id: "custom-b", label: "Custom B" },
        { id: "ultracode", label: "Ultra code" },
        { id: "custom-a", label: "Custom A" },
        { id: "default", label: "Default" },
        { id: "minimal", label: "Minimal" },
      ]).map((option) => option.id),
    ).toEqual(["default", "minimal", "custom-b", "custom-a", "ultracode", "max"]);
  });
});
