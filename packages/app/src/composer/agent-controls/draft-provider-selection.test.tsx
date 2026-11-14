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
      create: (build: ((theme: Theme) => unknown) | object) =>
        typeof build === "function" ? build(darkTheme) : build,
    },
    withUnistyles: (component: unknown) => component,
  };
});
vi.mock("@/components/model-browser", () => ({ ModelProviderGlyph: () => null }));
vi.mock("@/components/combined-model-selector", () => ({ CombinedModelSelector: () => null }));
vi.mock("@/components/ui/combobox", () => ({ Combobox: () => null, ComboboxItem: () => null }));
vi.mock("./model-sheet", () => ({ CompactModelSheet: () => null }));
vi.mock("./mode-control", () => ({
  AgentModeControl: () => null,
  useLiveAgentModeControl: () => null,
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({}));
vi.mock("@/hooks/use-providers-snapshot", () => ({ useProvidersSnapshot: vi.fn() }));
vi.mock("@/hooks/use-form-preferences", () => ({
  mergeProviderPreferences: vi.fn(),
  useFormPreferences: vi.fn(),
}));
vi.mock("@/contexts/toast-context", () => ({ useToast: vi.fn() }));
vi.mock("@/command-center/provider", () => ({ useCommandCenterActions: vi.fn() }));
vi.mock("@/command-center/model-contributions", () => ({ buildModelChoiceContributions: vi.fn() }));
vi.mock("@/command-center/provider-icon", () => ({ getCommandCenterProviderIcon: vi.fn() }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: vi.fn() }));
vi.mock("./control", () => ({
  AgentControlIconGlyph: () => null,
  AgentControlTrigger: () => null,
}));
vi.mock("./codex-provider-injection-control", () => ({
  CodexProviderInjectionControl: () => null,
}));

interface TestMenuProps {
  children: ReactNode;
  disabled?: boolean;
  testID?: string;
  onSelect?: () => void;
  selected?: boolean;
}
function MenuTrigger({ children, disabled, testID }: TestMenuProps) {
  return (
    <button type="button" data-testid={testID} disabled={disabled}>
      {children}
    </button>
  );
}
function MenuItem({ children, disabled, testID, onSelect, selected }: TestMenuProps) {
  return (
    <button
      type="button"
      data-testid={testID}
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
    >
      {children}
    </button>
  );
}
function MenuContainer({ children }: TestMenuProps) {
  return children;
}
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: MenuContainer,
  DropdownMenuTrigger: MenuTrigger,
  DropdownMenuContent: MenuContainer,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: MenuItem,
  DropdownMenuSub: MenuContainer,
  DropdownMenuSubTrigger: MenuTrigger,
  DropdownMenuSubContent: MenuContainer,
}));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  vi.unstubAllGlobals();
});

function renderDraft(disabled = false) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("测试挂载点不存在");
  const root = createRoot(container);
  roots.push(root);
  const onSelectProvider = vi.fn();
  const onSelectProviderAndModel = vi.fn();
  const props: DraftAgentControlsProps = {
    providerDefinitions: [],
    selectedProvider: "codex",
    onSelectProvider,
    modeOptions: [],
    selectedMode: "",
    onSelectMode: vi.fn(),
    models: [],
    selectedModel: "",
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
              favoriteKey: "codex:one",
              provider: "codex",
              providerLabel: "Codex",
              modelId: "one",
              modelLabel: "Codex 模型",
            },
          ],
        },
      },
      {
        id: "claude",
        label: "Claude",
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "claude:one",
              provider: "claude",
              providerLabel: "Claude",
              modelId: "one",
              modelLabel: "Claude 模型",
            },
          ],
        },
      },
    ],
    isAllModelsLoading: false,
    onSelectProviderAndModel,
    thinkingOptions: [],
    selectedThinkingOptionId: "",
    onSelectThinkingOption: vi.fn(),
    disabled,
  };
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <DraftAgentControls {...props} />
      </QueryClientProvider>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="agent-role-selector"]');
  if (!trigger) throw new Error("新会话的智能体选择入口不存在");
  return { dom, container, trigger, onSelectProvider, onSelectProviderAndModel };
}

describe("新会话智能体选择", () => {
  it("浏览提供方不提前切换，确认模型才提交提供方与模型", () => {
    const { dom, container, trigger, onSelectProvider, onSelectProviderAndModel } = renderDraft();
    expect(trigger.disabled).toBe(false);
    const provider = container.querySelector('[aria-label="Claude"]');
    if (!provider) throw new Error("缺少 Claude 目录入口");
    act(() => provider.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    expect(onSelectProvider).not.toHaveBeenCalled();
    const model = container.querySelector('[data-testid="model-row-claude-one"]');
    if (!model) throw new Error("缺少 Claude 模型入口");
    act(() => model.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    expect(onSelectProviderAndModel).toHaveBeenCalledWith("claude", "one");
  });
  it("禁用草稿时不允许打开模型菜单", () => {
    const { trigger } = renderDraft(true);
    expect(trigger.disabled).toBe(true);
  });
});
