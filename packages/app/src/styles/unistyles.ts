import { StyleSheet } from "react-native-unistyles";
import {
  lightTheme,
  darkTheme,
  darkZincTheme,
  darkMidnightTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  REGISTERED_THEMES,
} from "./theme";

StyleSheet.configure({
  themes: REGISTERED_THEMES,
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 720,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
    // 网页端的 CSS 变量只覆盖字符串主题值，数字字号会滞留在旧样式类中。
    // 关闭后，运行时更新主题会让已挂载节点统一重算颜色、字体和字号。
    CSSVars: false,
  },
});

// Type augmentation for TypeScript
interface AppThemes {
  light: typeof lightTheme;
  dark: typeof darkTheme;
  darkZinc: typeof darkZincTheme;
  darkMidnight: typeof darkMidnightTheme;
  darkClaude: typeof darkClaudeTheme;
  darkGhostty: typeof darkGhosttyTheme;
  pluginLight: typeof lightTheme;
  pluginDark: typeof darkTheme;
}

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
