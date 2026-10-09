import { describe, expect, it } from "vitest";
import { REGISTERED_THEMES } from "@/styles/theme";
import { resolveTextBrightness } from "./text-brightness";

describe("文字亮度", () => {
  it.each(Object.entries(REGISTERED_THEMES))("100%% 原样保留 %s 的前景配色", (_key, theme) => {
    expect(
      resolveTextBrightness({
        foreground: theme.baseForeground,
        background: theme.colors.surface0,
        colorScheme: theme.colorScheme,
        brightness: 100,
      }),
    ).toBe(theme.colors.foreground);
  });

  it.each([
    [70, "#999999"],
    [100, "#D3D3D3"],
    [125, "#e9e9e9"],
    [150, "#ffffff"],
  ])("深色主题 %s%% 映射为 %s", (brightness, expected) => {
    expect(
      resolveTextBrightness({
        foreground: "#D3D3D3",
        background: "#111111",
        colorScheme: "dark",
        brightness,
      }),
    ).toBe(expected);
  });

  it.each([
    [70, "#5f5f62"],
    [100, "#1a1a1e"],
    [125, "#0d0d0f"],
    [150, "#000000"],
  ])("浅色主题 %s%% 映射为 %s", (brightness, expected) => {
    expect(
      resolveTextBrightness({
        foreground: "#1a1a1e",
        background: "#ffffff",
        colorScheme: "light",
        brightness,
      }),
    ).toBe(expected);
  });

  it("第三方主题保留色相与透明度，并支持短十六进制颜色", () => {
    expect(
      resolveTextBrightness({
        foreground: "#a1b2c380",
        background: "#123",
        colorScheme: "dark",
        brightness: 125,
      }),
    ).toBe("#d0d9e180");
    expect(
      resolveTextBrightness({
        foreground: "#abc",
        background: "#000",
        colorScheme: "dark",
        brightness: 75,
      }),
    ).toBe("#808c99");
  });

  it("相邻百分比不被量化成预设档位", () => {
    const colors = [99, 100, 101].map((brightness) =>
      resolveTextBrightness({
        foreground: "#D3D3D3",
        background: "#111111",
        colorScheme: "dark",
        brightness,
      }),
    );
    expect(new Set(colors).size).toBe(3);
  });

  it("不支持的颜色格式明确失败", () => {
    expect(() =>
      resolveTextBrightness({
        foreground: "invalid",
        background: "#111111",
        colorScheme: "dark",
        brightness: 90,
      }),
    ).toThrow("Unsupported text brightness color");
  });
});
