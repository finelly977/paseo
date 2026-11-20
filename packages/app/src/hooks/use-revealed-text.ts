import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  beginTextReveal,
  getDefaultRevealedTextScheduler,
  isTextRevealPacingSupported,
  isTextRevealSettled,
  retargetTextReveal,
  type RevealedTextOwnerHandle,
  type RevealedTextScheduler,
  type TextRevealState,
  visibleRevealedText,
} from "@/agent-stream/text-reveal";
import type { MarkdownPhase } from "@/components/markdown/fence/types";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";
import { useRetainedPanelActive } from "@/components/retained-panel";

export interface UseRevealedTextOptions {
  /** 会话或消息级所有权标识（如 `${agentId}:${itemId}`），切换所有权时立即重置并停止旧帧调度。 */
  ownerKey?: string;
  /** 仅用于测试注入自定义帧调度器。 */
  scheduler?: RevealedTextScheduler;
}

/**
 * 把 `@/agent-stream/text-reveal` 的节奏策略接到按会话/消息所有权管理的统一帧调度器。
 * 收到新目标文本时只更新游标，不再每批取消并重建 `requestAnimationFrame`；
 * 切换会话、停止流式、到达终态或开启减少动态效果时立即补齐当前已收到的全部安全文本。
 */
export function useRevealedText(
  text: string,
  phase: MarkdownPhase,
  options?: UseRevealedTextOptions,
): string {
  const pacingSupported = isTextRevealPacingSupported();
  const reducedMotion = useReducedMotionPreference();
  const panelActive = useRetainedPanelActive();
  // 同一会话可以同时挂载在不同面板，各节点的生命周期必须独立。
  const instanceId = useId();
  const resolvedOwnerKey = `${instanceId}:${options?.ownerKey ?? ""}`;
  const scheduler = options?.scheduler ?? getDefaultRevealedTextScheduler();

  const lastOwnerKeyRef = useRef<string>(resolvedOwnerKey);
  const stateRef = useRef<TextRevealState>(beginTextReveal(text));
  const [, forceRender] = useState(0);

  const isStreaming = phase === "streaming";
  const shouldPace = pacingSupported && isStreaming && panelActive && !reducedMotion;

  if (lastOwnerKeyRef.current !== resolvedOwnerKey) {
    // 切换会话或复用槽位展示另一条消息时，立即丢弃旧所有权的进度游标。
    lastOwnerKeyRef.current = resolvedOwnerKey;
    stateRef.current = beginTextReveal(text);
  } else if (!shouldPace) {
    // 终态、手动停止、禁用节奏或减少动态效果时，同步补齐全部已收到文本。
    stateRef.current = beginTextReveal(text);
  } else {
    stateRef.current = retargetTextReveal(stateRef.current, text);
  }

  const ownerHandle = useMemo<RevealedTextOwnerHandle>(
    () => ({
      getState: () => stateRef.current,
      setState: (next) => {
        stateRef.current = next;
      },
      notify: () => {
        forceRender((tick) => tick + 1);
      },
    }),
    [],
  );

  // 所有权与生命周期仅受 ownerKey / 节奏开关 / 流式阶段控制，绝不因目标 text 更新重建调度。
  useEffect(() => {
    if (!shouldPace) {
      scheduler.unregister(resolvedOwnerKey, ownerHandle);
      return;
    }
    scheduler.register(resolvedOwnerKey, ownerHandle);
    return () => {
      scheduler.unregister(resolvedOwnerKey, ownerHandle);
    };
  }, [ownerHandle, resolvedOwnerKey, scheduler, shouldPace]);

  // 当新批次产生积压时按需激活当前所有者，已在运行中的调度不会被取消或重启。
  useEffect(() => {
    if (!shouldPace || isTextRevealSettled(stateRef.current)) {
      return;
    }
    scheduler.activate(resolvedOwnerKey, ownerHandle);
  });

  return pacingSupported ? visibleRevealedText(stateRef.current, { streaming: isStreaming }) : text;
}
