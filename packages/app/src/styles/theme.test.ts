import { describe, expect, test } from "vitest";

import { darkTheme, darkZincTheme, lightTheme, REGISTERED_THEMES, THEME_SWATCHES } from "./theme";

describe("默认 Dark 主题", () => {
  test("使用炭黑层级和低饱和蓝灰选中态", () => {
    expect(darkTheme.colors).toMatchObject({
      surface0: "#121416",
      surface1: "#121416",
      surface2: "#202224",
      surface3: "#2A2D30",
      surface4: "#3A3E42",
      surfaceDiffEmpty: "#191B1D",
      surfaceSidebar: "#191B1D",
      surfaceSidebarHover: "#202224",
      surfaceWorkspace: "#121416",
      surfaceSidebarSelected: "#263139",
      background: "#121416",
      foreground: "#D3D3D3",
      popoverForeground: "#D3D3D3",
      accent: "#0169CC",
      success: "#16A34A",
    });
    expect(darkTheme.colors.terminal).toMatchObject({
      background: "#121416",
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

  test("侧栏普通字略暗于正文，辅助字与状态色保持原样", () => {
    expect(darkTheme.colors.foregroundSidebar).toBe("#c4c4c4");
    expect(darkTheme.colors.foreground).toBe("#D3D3D3");
    expect(darkTheme.colors.foregroundMuted).toBe("#A3A3A3");
    expect(darkTheme.colors.scmStatusAdded).toBe("#81b88b");
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
