import { useEffect } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { applyWebScrollbarHandleColor } from "@/styles/web-scrollbar";

interface WebScrollbarThemeSyncProps {
  handleColor: string;
}

function WebScrollbarThemeSyncBase({ handleColor }: WebScrollbarThemeSyncProps): null {
  useEffect(() => {
    if (typeof document === "undefined") return;
    applyWebScrollbarHandleColor(document.documentElement.style, handleColor);
  }, [handleColor]);

  return null;
}

const scrollbarThemeMapping = (theme: Theme): WebScrollbarThemeSyncProps => ({
  handleColor: theme.colors.scrollbarHandle,
});

const ThemedWebScrollbarThemeSync = withUnistyles(WebScrollbarThemeSyncBase);

export function WebScrollbarThemeSync() {
  return <ThemedWebScrollbarThemeSync uniProps={scrollbarThemeMapping} />;
}
