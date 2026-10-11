import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { StyleSheet as NativeStyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { darkTheme, lightTheme, type Theme } from "@/styles/theme";
import { CodexProviderInjectionControl } from "./codex-provider-injection-control";

const state = vi.hoisted(() => ({
  theme: null as Theme | null,
  pressed: false,
  hovered: false,
  open: false,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (build: (theme: Theme) => Record<string, ViewStyle>) =>
      new Proxy(
        {},
        {
          get: (_target, name: string) => {
            if (!state.theme) throw new Error("测试主题未设置");
            return build(state.theme)[name];
          },
        },
      ),
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./control", () => ({ AgentControlIconGlyph: () => null }));
vi.mock("./glyph", () => ({ ComposerToolbarGlyph: () => null }));
vi.mock("./layout-context", () => ({ useComposerControlLayout: () => ({ glyphSize: 16 }) }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: ({
    children,
    style,
  }: {
    children: ReactNode;
    style: (value: typeof state) => StyleProp<ViewStyle>;
  }) =>
    React.createElement(
      "button",
      { type: "button", style: NativeStyleSheet.flatten(style(state)) },
      children,
    ),
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSub: () => null,
  DropdownMenuSubContent: () => null,
  DropdownMenuSubTrigger: () => null,
}));

afterEach(() => vi.unstubAllGlobals());
const onSelect = () => undefined;

function renderControl(
  theme: Theme,
  surface: "toolbar" | "sheet",
  interactive = false,
): HTMLButtonElement {
  state.theme = theme;
  state.hovered = interactive;
  state.pressed = false;
  state.open = false;
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(
    <CodexProviderInjectionControl
      injections={[]}
      selectedInjectionId={null}
      selectedModelId=""
      onSelect={onSelect}
      surface={surface}
    />,
  );
  const button = new JSDOM(html).window.document.querySelector("button");
  if (!button) throw new Error("服务商注入入口未渲染");
  return button;
}
function browserColor(color: string): string {
  const element = new JSDOM().window.document.createElement("div");
  element.style.color = color;
  return element.style.color;
}

describe.each([
  { name: "深色", theme: darkTheme },
  { name: "浅色", theme: lightTheme },
])("$name主题服务商注入入口", ({ theme }) => {
  it("菜单默认不覆盖底色，不形成独立深色卡片", () => {
    expect(renderControl(theme, "sheet").style.backgroundColor).toBe("");
  });
  it("菜单悬停使用其他菜单项相同的高亮层级", () => {
    expect(renderControl(theme, "sheet", true).style.backgroundColor).toBe(
      browserColor(theme.colors.surface3),
    );
  });
  it("工具栏保留原有悬停颜色，不受菜单修复影响", () => {
    expect(renderControl(theme, "toolbar", true).style.backgroundColor).toBe(
      browserColor(theme.colors.surface2),
    );
  });
});
