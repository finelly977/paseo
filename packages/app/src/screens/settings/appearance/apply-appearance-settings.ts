import { UnistylesRuntime } from "react-native-unistyles";
import type { AppSettings } from "@/hooks/use-settings";
import { THEME_TO_UNISTYLES, type ThemeName } from "@/styles/theme";
import { applyAppearance, type AppearanceInput } from "./apply-appearance";

export type AppearanceSettings = Pick<
  AppSettings,
  "theme" | "uiFontFamily" | "monoFontFamily" | "uiFontSize" | "codeFontSize" | "syntaxTheme"
>;

export interface AppearanceSettingsRuntime {
  applyAppearance(input: AppearanceInput): void;
  setAdaptiveThemes(enabled: boolean): void;
  setTheme(theme: ThemeName): void;
}

const appearanceSettingsRuntime: AppearanceSettingsRuntime = {
  applyAppearance,
  setAdaptiveThemes: (enabled) => UnistylesRuntime.setAdaptiveThemes(enabled),
  setTheme: (theme) => UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[theme]),
};

export function applyAppearanceSettings(
  settings: AppearanceSettings,
  runtime: AppearanceSettingsRuntime = appearanceSettingsRuntime,
): void {
  runtime.applyAppearance({
    uiFontFamily: settings.uiFontFamily,
    monoFontFamily: settings.monoFontFamily,
    uiFontSize: settings.uiFontSize,
    codeFontSize: settings.codeFontSize,
    syntaxTheme: settings.syntaxTheme,
  });

  if (settings.theme === "auto") {
    runtime.setAdaptiveThemes(true);
    return;
  }

  runtime.setAdaptiveThemes(false);
  runtime.setTheme(settings.theme);
}
