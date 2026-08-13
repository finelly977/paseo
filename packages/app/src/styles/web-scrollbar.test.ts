import { describe, expect, it } from "vitest";
import {
  applyWebScrollbarHandleColor,
  WEB_SCROLLBAR_HANDLE_CSS_VAR,
  WEB_SCROLLBAR_HANDLE_FALLBACK,
  webScrollbarHandleCssValue,
} from "./web-scrollbar";

describe("webScrollbar", () => {
  it("使用 Paseo 自有变量并提供暗色回退值", () => {
    expect(webScrollbarHandleCssValue()).toBe(
      `var(${WEB_SCROLLBAR_HANDLE_CSS_VAR}, ${WEB_SCROLLBAR_HANDLE_FALLBACK})`,
    );
  });

  it("把当前主题颜色写入滚动条变量", () => {
    const properties = new Map<string, string>();

    applyWebScrollbarHandleColor(
      {
        setProperty: (property, value) => {
          properties.set(property, value);
        },
      },
      "#71717a",
    );

    expect(properties).toEqual(new Map([[WEB_SCROLLBAR_HANDLE_CSS_VAR, "#71717a"]]));
  });
});
