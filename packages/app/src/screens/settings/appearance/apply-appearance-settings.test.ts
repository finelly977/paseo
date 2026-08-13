import { describe, expect, it } from "vitest";
import {
  applyAppearanceSettings,
  type AppearanceSettings,
  type AppearanceSettingsRuntime,
} from "./apply-appearance-settings";
import type { AppearanceInput } from "./apply-appearance";

function makeSettings(overrides: Partial<AppearanceSettings> = {}): AppearanceSettings {
  return {
    theme: "dark",
    uiFontFamily: "Inter",
    monoFontFamily: "Consolas",
    uiFontSize: 14,
    codeFontSize: 12,
    syntaxTheme: "one",
    ...overrides,
  };
}

function createRuntime() {
  const calls: string[] = [];
  const runtime: AppearanceSettingsRuntime = {
    applyAppearance: (input) => {
      calls.push(`外观:${input.uiFontSize}:${input.codeFontSize}`);
    },
    setAdaptiveThemes: (enabled) => {
      calls.push(`自动主题:${enabled}`);
    },
    setTheme: (theme) => {
      calls.push(`固定主题:${theme}`);
    },
  };
  return { calls, runtime };
}

describe("applyAppearanceSettings", () => {
  it("先应用字号，再选择固定主题", () => {
    const { calls, runtime } = createRuntime();

    applyAppearanceSettings(makeSettings({ theme: "zinc", uiFontSize: 18 }), runtime);

    expect(calls).toEqual(["外观:18:12", "自动主题:false", "固定主题:zinc"]);
  });

  it("先应用字号，再启用自动主题", () => {
    const { calls, runtime } = createRuntime();

    applyAppearanceSettings(makeSettings({ theme: "auto", uiFontSize: 12 }), runtime);

    expect(calls).toEqual(["外观:12:12", "自动主题:true"]);
  });

  it("每次应用都使用完整的当前字体设置", () => {
    const inputs: AppearanceInput[] = [];
    const { runtime } = createRuntime();
    runtime.applyAppearance = (input) => {
      inputs.push(input);
    };

    applyAppearanceSettings(
      makeSettings({
        uiFontFamily: "Segoe UI",
        monoFontFamily: "Cascadia Code",
        uiFontSize: 18,
        codeFontSize: 16,
        syntaxTheme: "dracula",
      }),
      runtime,
    );

    expect(inputs).toEqual([
      {
        uiFontFamily: "Segoe UI",
        monoFontFamily: "Cascadia Code",
        uiFontSize: 18,
        codeFontSize: 16,
        syntaxTheme: "dracula",
      },
    ]);
  });
});
