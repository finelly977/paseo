import { describe, expect, test } from "vitest";

import { darkTheme, darkZincTheme, lightTheme, REGISTERED_THEMES, THEME_SWATCHES } from "./theme";

describe("默认 Dark 主题", () => {
  test("使用中性黑白表面和参考强调色", () => {
    expect(darkTheme.colors).toMatchObject({
      surface0: "#111111",
      surface1: "#111111",
      surface2: "#1F1F1F",
      surface3: "#2A2A2A",
      surface4: "#3A3A3A",
      surfaceDiffEmpty: "#181818",
      surfaceSidebar: "#0D0D0D",
      surfaceSidebarHover: "#1F1F1F",
      surfaceWorkspace: "#111111",
      background: "#111111",
      foreground: "#D3D3D3",
      popoverForeground: "#D3D3D3",
      accent: "#0169CC",
      success: "#16A34A",
    });
    expect(darkTheme.colors.terminal).toMatchObject({
      background: "#111111",
      foreground: "#D3D3D3",
      cursor: "#D3D3D3",
    });
    expect(THEME_SWATCHES.dark).toBe("#0169CC");
  });

  test("只降低暗色主题的亮字，不改变已有暗字和强调色", () => {
    expect(darkZincTheme.colors).toMatchObject({
      background: "#18181b",
      foreground: "#e0e0e4",
      foregroundMuted: "#a1a1aa",
      accent: "#e4e4e7",
    });
  });

  test("用户消息使用轻微灰色层，浅色滚动条不再采用深灰色", () => {
    expect(darkTheme.colors.userMessageBackground).toBe("#ffffff09");
    expect(lightTheme.colors.userMessageBackground).toBe("#00000007");
    expect(lightTheme.colors.scrollbarHandle).toBe("#a8a8b0");
    expect(lightTheme.colors.foreground).toBe("#1a1a1e");
    expect(darkTheme.colors.foregroundMuted).toBe("#A3A3A3");
  });

  test("为插件主题预留浅色和深色槽位", () => {
    expect(REGISTERED_THEMES.pluginLight).toBe(lightTheme);
    expect(REGISTERED_THEMES.pluginDark).toBe(darkTheme);
  });

  test("浅色主题的工作区选中背景与侧栏底色可区分", () => {
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });
});
