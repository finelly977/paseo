import { describe, expect, test } from "vitest";

import { darkTheme, darkZincTheme, THEME_SWATCHES } from "./theme";

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
      foreground: "#E6E6E6",
      popoverForeground: "#E6E6E6",
      accent: "#0169CC",
      success: "#16A34A",
    });
    expect(darkTheme.colors.terminal).toMatchObject({
      background: "#111111",
      foreground: "#E6E6E6",
      cursor: "#E6E6E6",
    });
    expect(THEME_SWATCHES.dark).toBe("#0169CC");
  });

  test("不改变独立的 Zinc 主题", () => {
    expect(darkZincTheme.colors).toMatchObject({
      background: "#18181b",
      foreground: "#fafafa",
      accent: "#e4e4e7",
    });
  });
});
