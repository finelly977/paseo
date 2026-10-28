import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@getpaseo/highlight";
import { DEFAULT_UI_FONT_STACK, DEFAULT_MONO_FONT_STACK, type Theme } from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";
import { resolveTextBrightness } from "./text-brightness";

// 所有已注册的 Unistyles 主题键；插件槽也必须叠加用户的字体、字号与语法主题。
// The `as const` element types are exactly `keyof UnistylesThemes`, so each key
// is assignable to `UnistylesRuntime.updateTheme`'s first argument with no cast.
const ALL_THEME_KEYS = [
  "light",
  "dark",
  "darkZinc",
  "darkMidnight",
  "darkClaude",
  "darkGhostty",
  "pluginLight",
  "pluginDark",
] as const;

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiFontSize: number; // already clamped
  textBrightness: number;
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
}

// 所有普通界面文字共用一个字号；层级由字重、颜色和间距表达。
function resolveFontSize(uiSize: number, codeSize: number): Theme["fontSize"] {
  return {
    xs: uiSize,
    sm: uiSize,
    base: uiSize,
    lg: uiSize,
    xl: uiSize,
    "2xl": uiSize,
    "3xl": uiSize,
    "4xl": uiSize,
    code: codeSize,
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All six keys are patched because the active theme can change and adaptive mode
 * can flip light/dark — patching all keys keeps the active key always current and
 * makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const diffLineHeight = Math.round(input.codeFontSize * 1.5); // couple to code size

  for (const key of ALL_THEME_KEYS) {
    // Spread `...t` first — `updateTheme` replaces the stored theme, it does not
    // merge; an omitted key would be dropped. `syntax` follows the theme's own
    // scheme for `auto`; named palettes ignore it. `colors.base`/plain text stays
    // `theme.colors.foreground` (owned by `syntaxTokenStyles.base`, not patched).
    //
    // Narrow on the `colorScheme` discriminant before spreading: the updater must
    // return the theme union, and a spread of the union widens `colorScheme` to
    // `"light" | "dark"`, assignable to neither concrete member. Each branch spreads
    // a single narrowed theme type.
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, mono };
      const fontSize = resolveFontSize(input.uiFontSize, input.codeFontSize);
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      const foreground = resolveTextBrightness({
        foreground: t.baseForeground,
        background: t.colors.surface0,
        colorScheme: t.colorScheme,
        brightness: input.textBrightness,
      });
      const textColors = {
        foreground,
        foregroundSidebar: resolveTextBrightness({
          foreground,
          background: t.colors.surfaceSidebar,
          colorScheme: t.colorScheme,
          brightness: 92,
        }),
        popoverForeground: foreground,
        secondaryForeground: foreground,
      };
      if (t.colorScheme === "light") {
        return {
          ...t,
          fontFamily,
          fontSize,
          lineHeight,
          colors: {
            ...t.colors,
            ...textColors,
            syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme),
          },
        };
      }
      return {
        ...t,
        fontFamily,
        fontSize,
        lineHeight,
        colors: {
          ...t.colors,
          ...textColors,
          syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme),
        },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui, input.uiFontSize);
}
