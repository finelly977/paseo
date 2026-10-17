import { resolveCompactModelMenuHeight } from "./model-browser-view";
import { describe, expect, it } from "vitest";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  resolveInitialModelBrowserView,
  resolveModelBrowserAllView,
  resolveModelBrowserScrolling,
} from "./model-browser-view";

function provider(
  id: string,
  label: string,
  rows: ProviderSelectionModelRow[] = [],
): ProviderSelectorProvider {
  return {
    id,
    label,
    modelSelection: { kind: "models", rows },
  };
}

function modelRow(
  providerId: string,
  providerLabel: string,
  modelId: string,
  modelLabel: string,
): ProviderSelectionModelRow {
  return {
    favoriteKey: `${providerId}:${modelId}`,
    provider: providerId,
    providerLabel,
    modelId,
    modelLabel,
    description: modelId,
  };
}

describe("model browser initial view", () => {
  const codex = provider("codex", "Codex");
  const pi = provider("pi", "Pi");

  it("opens a sole provider directly", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [pi],
        selectedProvider: "",
        selectedModel: "",
        hasProfiles: false,
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("新草稿已选择智能体时直接打开该智能体模型", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: false,
        providerLocked: false,
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("已选择智能体时有配置档案也直接显示模型", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: true,
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });

  it("单智能体和档案同样直达模型", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [pi],
        selectedProvider: "pi",
        selectedModel: "pi-pro",
        hasProfiles: true,
      }),
    ).toEqual({ kind: "provider", providerId: "pi", providerLabel: "Pi" });
  });
  it("固定智能体的会话有配置档案时也直接进入该智能体模型", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex],
        selectedProvider: "codex",
        selectedModel: "",
        hasProfiles: true,
        providerLocked: true,
      }),
    ).toEqual({ kind: "provider", providerId: "codex", providerLabel: "Codex" });
  });

  it("falls back to the root when the selected provider is gone", () => {
    expect(
      resolveInitialModelBrowserView({
        providers: [codex, pi],
        selectedProvider: "gemini",
        selectedModel: "gemini-3",
        hasProfiles: false,
      }),
    ).toEqual({ kind: "all" });
  });
});

describe("model browser scrolling", () => {
  it("uses the bottom sheet scroll owner on compact native layouts", () => {
    expect(resolveModelBrowserScrolling({ isNative: true, isCompact: true })).toBe("sheet");
  });

  it("lets iPad wide layouts own their popout scrolling", () => {
    expect(resolveModelBrowserScrolling({ isNative: true, isCompact: false })).toBe("independent");
  });

  it("keeps web and desktop popouts independent", () => {
    expect(resolveModelBrowserScrolling({ isNative: false, isCompact: false })).toBe("independent");
  });
});

describe("model browser all view", () => {
  const claude = provider("claude", "Claude Code", [
    modelRow("claude", "Claude Code", "opus-5", "Opus 5"),
    modelRow("claude", "Claude Code", "sonnet-4.6", "Sonnet 4.6"),
  ]);
  const copilot = provider("copilot", "Copilot", [
    modelRow("copilot", "Copilot", "claude-opus-5", "Opus 5"),
  ]);
  const codex = provider("codex", "Codex", [modelRow("codex", "Codex", "gpt-5.4", "GPT-5.4")]);
  const providers = [claude, copilot, codex];

  it("browses providers while the query is empty", () => {
    expect(resolveModelBrowserAllView({ providers, normalizedQuery: "" })).toEqual({
      kind: "browse",
    });
  });

  it("ranks the same model label across every provider that offers it", () => {
    const view = resolveModelBrowserAllView({ providers, normalizedQuery: "opus" });

    expect(view.kind).toBe("searchResults");
    expect(view.kind === "searchResults" ? view.rows.map((row) => row.favoriteKey) : []).toEqual([
      "claude:opus-5",
      "copilot:claude-opus-5",
    ]);
  });

  it("matches models by their provider label", () => {
    const view = resolveModelBrowserAllView({ providers, normalizedQuery: "codex" });

    expect(view.kind === "searchResults" ? view.rows.map((row) => row.modelId) : []).toEqual([
      "gpt-5.4",
    ]);
  });

  it("reports no matches instead of falling back to the provider list", () => {
    expect(resolveModelBrowserAllView({ providers, normalizedQuery: "zzzz" })).toEqual({
      kind: "noSearchMatches",
    });
  });

  it("ignores providers that are still loading or errored", () => {
    const loading: ProviderSelectorProvider = {
      id: "opencode",
      label: "OpenCode",
      modelSelection: { kind: "loading" },
    };
    const failed: ProviderSelectorProvider = {
      id: "pi",
      label: "Pi",
      modelSelection: { kind: "error", message: "unavailable" },
    };

    expect(
      resolveModelBrowserAllView({ providers: [loading, failed], normalizedQuery: "opus" }),
    ).toEqual({ kind: "noSearchMatches" });
  });
});

describe("模型菜单的紧凑高度", () => {
  it("少量模型不再占用 220 像素空框，长列表保留滚动上限", () => {
    expect(resolveCompactModelMenuHeight(1)).toBe(152);
    expect(resolveCompactModelMenuHeight(2)).toBe(192);
    expect(resolveCompactModelMenuHeight(20)).toBe(400);
    expect(resolveCompactModelMenuHeight(7)).toBe(392);
  });
  it("空模型仍保留搜索、创建配置和空状态的空间", () => {
    expect(resolveCompactModelMenuHeight(0)).toBe(152);
  });
  it("配置档案也占据列表空间，不将其高度误算为留白", () => {
    expect(resolveCompactModelMenuHeight(2, 2)).toBe(296);
    expect(resolveCompactModelMenuHeight(20, 2)).toBe(400);
  });
});
