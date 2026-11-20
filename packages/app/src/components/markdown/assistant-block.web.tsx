import React, {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
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

export const AssistantMessageBlockContainer = memo(function AssistantMessageBlockContainer({
  block,
  marginBottom,
  measureFinalHeight = true,
  children,
}: {
  block: string;
  marginBottom: number;
  measureFinalHeight?: boolean;
  children: ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const style = useMemo(() => ({ ...blockStyle, marginBottom }), [marginBottom]);

  // 文本变化只更新映射表，不重绑 ResizeObserver。
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (!measureFinalHeight) {
      blockByElement.delete(element);
      return;
    }
    blockByElement.set(element, block);
  }, [block, measureFinalHeight]);

  // 仅针对终态/已稳定块绑定和解绑 ResizeObserver；活动流式尾块暂不测高缓存，
  // 也不随文本每帧增长反复 disconnect/observe 或污染长期块高度缓存。
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || !measureFinalHeight) {
      return;
    }
    const observer = getBlockObserver();
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      blockByElement.delete(element);
    };
  }, [measureFinalHeight]);

  return (
    <div ref={elementRef} style={style}>
      {children}
    </div>
  );
});
