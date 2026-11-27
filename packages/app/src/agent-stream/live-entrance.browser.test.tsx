import React, { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";

const ROW_STYLE = { height: 72, lineHeight: "72px" } as const;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function userItem(id: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: new Date(1000) };
}

function assistantItem(id: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(2000) };
}

function toolItem(id: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(1500),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "shell",
        status: "running",
        error: null,
        detail: { type: "shell", command: `echo ${id}` },
      },
    },
  };
}

function renderRow(item: StreamItem) {
  return <div style={ROW_STYLE}>{item.id}</div>;
}

test("运行中新增命令与回复触发合成层入场动画并平滑追尾，历史条目不重播且用户上滚立即停止追尾", async () => {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:720px;height:320px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
  const viewportRef = createRef<StreamViewportHandle>();

  const initialHistory: StreamItem[] = [
    userItem("u-1"),
    assistantItem("a-1"),
    userItem("u-2"),
    assistantItem("a-2"),
    userItem("u-3"),
    assistantItem("a-3"),
    userItem("u-4"),
  ];

  const renderState = (input: {
    historyMounted: StreamItem[];
    liveHead: StreamItem[];
    isRunning: boolean;
  }) => {
    const props: StreamRenderInput = {
      agentId: "live-motion-browser-test",
      isRunning: input.isRunning,
      segments: {
        historyVirtualized: [],
        historyMounted: input.historyMounted,
        liveHead: input.liveHead,
      },
      boundary: {
        hasVirtualizedHistory: false,
        hasMountedHistory: input.historyMounted.length > 0,
        hasLiveHead: input.liveHead.length > 0,
      },
      renderers: {
        renderHistoryVirtualizedRow: renderRow,
        renderHistoryMountedRow: renderRow,
        renderLiveHeadRow: renderRow,
        renderLiveAuxiliary: () => null,
      },
      viewportRef,
      routeBottomAnchorRequest: null,
      isAuthoritativeHistoryReady: true,
      onNearBottomChange: () => {},
      onNearHistoryStart: () => {},
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      messageParagraphSpacing: 8,
      conversationVerticalPadding: 16,
      listEmptyComponent: null,
      listStyle: null,
      baseListContentContainerStyle: null,
      forwardListContentContainerStyle: null,
    };
    root.render(strategy.render(props));
  };

  try {
    renderState({ historyMounted: initialHistory, liveHead: [], isRunning: true });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    const viewport = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!viewport) throw new Error("缺少对话滚动视口");

    // 首次挂载的历史行不能播放入场动画，且初始对齐到底部。
    const initialRow = host.querySelector<HTMLElement>('[data-stream-row-id="a-3"]');
    expect(initialRow?.getAnimations().length ?? 0).toBe(0);
    await expect
      .poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
      .toBeLessThanOrEqual(2);

    // 运行中高速连续追加命令与回复：仅新行播放合成层入场动画并平滑追尾到底部。
    const cmd1 = toolItem("tc-live-1");
    const reply1 = assistantItem("a-live-1");
    flushSync(() => {
      renderState({
        historyMounted: [...initialHistory, cmd1],
        liveHead: [reply1],
        isRunning: true,
      });
    });

    const cmdRow = host.querySelector<HTMLElement>('[data-stream-row-id="tc-live-1"]');
    const replyRow = host.querySelector<HTMLElement>('[data-stream-row-id="a-live-1"]');
    expect(cmdRow).not.toBeNull();
    expect(replyRow).not.toBeNull();
    expect(cmdRow?.getAnimations().length ?? 0).toBeGreaterThan(0);
    expect(replyRow?.getAnimations().length ?? 0).toBeGreaterThan(0);
    expect(initialRow?.getAnimations().length ?? 0).toBe(0);

    // 平滑追尾会在数帧内自然滑至底部。
    await expect
      .poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop, {
        timeout: 3000,
      })
      .toBeLessThanOrEqual(2);

    // 历史前插绝不能触发入场动画。
    flushSync(() => {
      renderState({
        historyMounted: [userItem("u-0"), assistantItem("a-0"), ...initialHistory, cmd1],
        liveHead: [reply1],
        isRunning: true,
      });
    });
    const prependedRow = host.querySelector<HTMLElement>('[data-stream-row-id="a-0"]');
    expect(prependedRow).not.toBeNull();
    expect(prependedRow?.getAnimations().length ?? 0).toBe(0);

    // 用户向上滚动后立刻脱离追尾，后续新增回复不会把视口拉回底部。
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event("scroll"));
    await nextFrame();
    const userReadTop = viewport.scrollTop;

    renderState({
      historyMounted: [userItem("u-0"), assistantItem("a-0"), ...initialHistory, cmd1, reply1],
      liveHead: [assistantItem("a-live-2")],
      isRunning: true,
    });
    for (let frame = 0; frame < 10; frame += 1) await nextFrame();
    expect(viewport.scrollTop).toBeLessThanOrEqual(userReadTop + 4);
  } finally {
    root.unmount();
    host.remove();
  }
});
