import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftAgentControls, type DraftAgentControlsProps } from "./index";
import type { Theme } from "@/styles/theme";

vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (build: ((theme: Theme) => unknown) | Record<string, unknown>) =>
        typeof build === "function" ? build(darkTheme) : build,
    },
    withUnistyles: (component: unknown) => component,
  };
});
vi.mock("@/components/model-browser", () => ({ ModelProviderGlyph: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: ({ children, testID }: { children: ReactNode; testID?: string }) => (
    <button type="button" data-testid={testID}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/combobox", () => ({ Combobox: () => null, ComboboxItem: () => null }));
vi.mock("@/components/ui/combobox-trigger", () => ({
  ComboboxTrigger: ({ children, testID }: { children: ReactNode; testID?: string }) => (
    <button type="button" data-testid={testID}>
      {children}
    </button>
  ),
}));
vi.mock("@/hooks/use-shortcut-keys", () => ({ useShortcutKeys: () => null }));
vi.mock("@/hooks/use-keyboard-action-handler", () => ({ useKeyboardActionHandler: () => {} }));
vi.mock("@/composer/keyboard-scope", () => ({
  useComposerKeyboardScope: () => ({ isActiveComposer: false }),
}));
vi.mock("@/hooks/use-providers-snapshot", () => ({ useProvidersSnapshot: vi.fn() }));
vi.mock("@/hooks/use-form-preferences", () => ({
  mergeProviderPreferences: vi.fn(),
  useFormPreferences: () => ({ updatePreferences: vi.fn() }),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock("@/command-center/provider", () => ({ useCommandCenterActions: vi.fn() }));
vi.mock("@/command-center/model-contributions", () => ({ buildModelChoiceContributions: vi.fn() }));
vi.mock("@/command-center/provider-icon", () => ({ getCommandCenterProviderIcon: vi.fn() }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: vi.fn() }));
vi.mock("./model-sheet", () => ({ CompactModelSheet: () => null }));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  vi.unstubAllGlobals();
});

function mountDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("Missing root");
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

describe("desktop composer controls & model menu", () => {
  it("displays permission mode directly on the composer toolbar and removes duplicate mode from model menu footer", () => {
    const { container, root } = mountDom();
    const props: DraftAgentControlsProps = {
      providerDefinitions: [],
      selectedProvider: "codex",
      onSelectProvider: vi.fn(),
      modeOptions: [
        { id: "auto", label: "Default" },
        { id: "full-access", label: "Full access" },
      ],
      selectedMode: "full-access",
      onSelectMode: vi.fn(),
      models: [{ provider: "codex", id: "gpt-5.4", label: "GPT-5.4" }],
      selectedModel: "gpt-5.4",
      onSelectModel: vi.fn(),
      isModelLoading: false,
      modelSelectorProviders: [
        {
          id: "codex",
          label: "Codex",
          modelSelection: {
            kind: "models",
            rows: [
              {
                favoriteKey: "codex:gpt-5.4",
                provider: "codex",
                providerLabel: "Codex",
                modelId: "gpt-5.4",
                modelLabel: "GPT-5.4",
              },
            ],
          },
        },
      ],
      isAllModelsLoading: false,
      onSelectProviderAndModel: vi.fn(),
      thinkingOptions: [{ id: "high", label: "High" }],
      selectedThinkingOptionId: "high",
      onSelectThinkingOption: vi.fn(),
      features: [{ type: "toggle", id: "fast_mode", label: "Fast", value: false }],
      onSetFeature: vi.fn(),
    };

    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DraftAgentControls {...props} />
        </QueryClientProvider>,
      ),
    );

    expect(container.querySelector('[data-testid="agent-role-selector"]')).not.toBeNull();
    const modeButtons = container.querySelectorAll('[data-testid="mode-control"]');
    // One on toolbar only, none duplicated inside the model menu footer.
    expect(modeButtons.length).toBe(1);
    expect(modeButtons[0]?.textContent).toContain("Full access");
    expect(container.textContent).toContain("标准");
    expect(container.textContent).toContain("快速");
  });
});
