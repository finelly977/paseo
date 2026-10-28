import React, { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { setAssistantMarkdownBlockHeight } from "@/utils/assistant-message-height-estimate";

const blockByElement = new WeakMap<Element, string>();
let blockObserver: ResizeObserver | null = null;

function getBlockObserver(): ResizeObserver {
  if (!blockObserver) {
    blockObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const block = blockByElement.get(entry.target);
        if (block === undefined) continue;
        // 这里只需要宽高。RN Web 的 onLayout 还会逐级读取祖先位置，快速换窗时成本很高。
        const { width, height } = entry.contentRect;
        setAssistantMarkdownBlockHeight({ block, width, height });
      }
    });
  }
  return blockObserver;
}

const blockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  position: "relative",
};

export function AssistantMessageBlockContainer({
  block,
  marginBottom,
  children,
}: {
  block: string;
  marginBottom: number;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const style = useMemo(() => ({ ...blockStyle, marginBottom }), [marginBottom]);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const observer = getBlockObserver();
    blockByElement.set(element, block);
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      blockByElement.delete(element);
    };
  }, [block]);
  return (
    <div ref={elementRef} style={style}>
      {children}
    </div>
  );
}
