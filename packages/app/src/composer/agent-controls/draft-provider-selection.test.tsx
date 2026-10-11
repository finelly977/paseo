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
    StyleSheet: { create: (build: (theme: Theme) => unknown) => build(darkTheme) },
    withUnistyles: (component: unknown) => component,
  };
});
vi.mock("@/agent-profiles", () => ({ useAgentProfilePicker: () => null }));
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
      { id: "codex", label: "Codex", modelSelection: { kind: "models", rows: [] } },
      { id: "claude", label: "Claude", modelSelection: { kind: "models", rows: [] } },
    ],
    isAllModelsLoading: false,
    onSelectProviderAndModel: vi.fn(),
    thinkingOptions: [],
    selectedThinkingOptionId: "",
    onSelectThinkingOption: vi.fn(),
    disabled,
  };
  act(() => root.render(<DraftAgentControls {...props} />));
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-testid="agent-provider-selector"]',
  );
  if (!trigger) throw new Error("新会话的智能体选择入口不存在");
  return { dom, container, trigger, onSelectProvider };
}

describe("新会话智能体选择", () => {
  it("草稿的智能体入口可用，选择 Claude 调用原有切换逻辑", () => {
    const { dom, container, trigger, onSelectProvider } = renderDraft();
    expect(trigger.disabled).toBe(false);
    const current = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Codex",
    );
    if (!current) throw new Error("当前智能体选项缺失");
    expect(current.getAttribute("aria-pressed")).toBe("true");
    const choice = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Claude",
    );
    if (!choice) throw new Error("主机的 Claude 选项缺失");
    act(() => choice.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    expect(onSelectProvider).toHaveBeenCalledExactlyOnceWith("claude");
  });
  it("创建提交期间仍禁止切换智能体", () => {
    expect(renderDraft(true).trigger.disabled).toBe(true);
  });
});
