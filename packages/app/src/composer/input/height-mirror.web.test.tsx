// @vitest-environment jsdom

import { createRef } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerHeightMirror } from "./height-mirror.web";

describe("useComposerHeightMirror", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次挂载时立即测量已经恢复的长草稿", () => {
    const source = document.createElement("textarea");
    Object.defineProperty(source, "clientWidth", { configurable: true, value: 420 });
    document.body.appendChild(source);

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "textarea" && element !== source) {
        Object.defineProperty(element, "scrollHeight", { configurable: true, value: 132 });
      }
      return element;
    }) as typeof document.createElement);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontFamily: "sans-serif",
      fontSize: "14px",
      fontWeight: "400",
      fontStyle: "normal",
      fontVariant: "normal",
      lineHeight: "20px",
      letterSpacing: "normal",
      wordSpacing: "normal",
      textTransform: "none",
      textIndent: "0px",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      overflowWrap: "break-word",
      wordBreak: "normal",
      tabSize: "8",
      paddingTop: "8px",
      paddingRight: "8px",
      paddingBottom: "8px",
      paddingLeft: "8px",
    } as CSSStyleDeclaration);

    const onHeight = vi.fn();
    const textareaRef = createRef<HTMLElement>();
    textareaRef.current = source;

    const { unmount } = renderHook(() =>
      useComposerHeightMirror({
        value: "这是从持久化草稿中恢复的多行长文本\n".repeat(12),
        textareaRef,
        minHeight: 44,
        maxHeight: 240,
        onHeight,
      }),
    );

    expect(onHeight).toHaveBeenCalledWith(132);
    unmount();
    source.remove();
  });
});
