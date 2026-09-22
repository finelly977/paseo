import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

interface Args {
  value: string;
  textareaRef: RefObject<HTMLElement | null>;
  minHeight: number;
  maxHeight: number;
  onHeight: (height: number) => void;
}

const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
  "wordBreak",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

export function useComposerHeightMirror({
  value,
  textareaRef,
  minHeight,
  maxHeight,
  onHeight,
}: Args): void {
  const paramsRef = useRef({ value, minHeight, maxHeight, onHeight });
  paramsRef.current = { value, minHeight, maxHeight, onHeight };

  const mirrorRef = useRef<HTMLTextAreaElement | null>(null);

  // 镜像必须在同一轮布局阶段先于下方的测量 effect 创建。若在普通 effect
  // 中创建，恢复出的长草稿第一次测量时镜像尚不存在，且文本没有再次变化时
  // 不会触发第二次测量，输入框就会一直停留在最小高度。
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const mirror = document.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.setAttribute("tabindex", "-1");
    mirror.readOnly = true;
    mirror.rows = 1;
    const style = mirror.style;
    style.position = "absolute";
    style.top = "0";
    style.left = "0";
    style.visibility = "hidden";
    style.pointerEvents = "none";
    style.overflow = "hidden";
    style.border = "0";
    style.margin = "0";
    style.resize = "none";
    style.zIndex = "-1";
    style.boxSizing = "border-box";
    document.body.appendChild(mirror);
    mirrorRef.current = mirror;
    return () => {
      mirror.remove();
      mirrorRef.current = null;
    };
  }, []);

  const measure = useCallback(() => {
    const mirror = mirrorRef.current;
    const source = textareaRef.current;
    if (!mirror || !source || typeof window === "undefined") return;
    if (!(source instanceof HTMLElement)) return;
    const sourceWidth = source.clientWidth;
    if (sourceWidth <= 0) return;

    const cs = window.getComputedStyle(source);
    const ms = mirror.style;
    for (const prop of COPIED_STYLES) {
      ms[prop] = cs[prop];
    }
    ms.width = `${sourceWidth}px`;

    const {
      value: currentValue,
      minHeight: currentMinHeight,
      maxHeight: currentMaxHeight,
      onHeight: currentOnHeight,
    } = paramsRef.current;
    // Trailing newline is collapsed by textarea measurement — pad with a space.
    mirror.value = currentValue.endsWith("\n") ? `${currentValue} ` : currentValue;

    const next = Math.max(currentMinHeight, Math.min(currentMaxHeight, mirror.scrollHeight));
    currentOnHeight(next);
  }, [textareaRef]);

  useLayoutEffect(() => {
    measure();
  }, [maxHeight, minHeight, value, measure]);

  useEffect(() => {
    const source = textareaRef.current;
    if (!source || !(source instanceof HTMLElement)) return;
    if (typeof ResizeObserver === "undefined") return;
    let previousWidth = source.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = source.clientWidth;
      if (Math.abs(nextWidth - previousWidth) < 1) return;
      previousWidth = nextWidth;
      measure();
    });
    observer.observe(source);
    return () => observer.disconnect();
  }, [textareaRef, measure]);
}
