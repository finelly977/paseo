export const WEB_SCROLLBAR_WIDTH = "thin";
export const WEB_SCROLLBAR_SIZE_PX = 8;
export const WEB_SCROLLBAR_HANDLE_CSS_VAR = "--paseo-scrollbar-handle";
export const WEB_SCROLLBAR_HANDLE_FALLBACK = "#3A3A3A";

export interface CssVariableStyle {
  setProperty(property: string, value: string): void;
}

export function webScrollbarHandleCssValue(): string {
  return `var(${WEB_SCROLLBAR_HANDLE_CSS_VAR}, ${WEB_SCROLLBAR_HANDLE_FALLBACK})`;
}

export function applyWebScrollbarHandleColor(style: CssVariableStyle, handleColor: string): void {
  style.setProperty(WEB_SCROLLBAR_HANDLE_CSS_VAR, handleColor);
}

export function webScrollbarThumbColor(handleColor: string): string {
  return `color-mix(in srgb, ${handleColor} 62%, transparent)`;
}

export function webScrollbarColor(handleColor: string): string {
  return `${webScrollbarThumbColor(handleColor)} transparent`;
}
