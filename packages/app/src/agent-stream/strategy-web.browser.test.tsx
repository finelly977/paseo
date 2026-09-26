import React, { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import { createWebStreamStrategy } from "./strategy-web";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";

function messages(start: number, count: number): StreamItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "user_message",
    id: `message-${start + index}`,
    text: `历史消息 ${start + index}`,
    timestamp: new Date(0),
  }));
}

let root: Root | null = null;
let host: HTMLDivElement;
const ROW_STYLE = { height: 80, flexShrink: 0 };

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

async function nextLayout(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function mountViewport(input: Partial<StreamRenderInput> = {}) {
  host = document.createElement("div");
  Object.assign(host.style, { display: "flex", width: "800px", height: "480px" });
  document.body.appendChild(host);
  root = createRoot(host);
  const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
  const viewportRef = createRef<StreamViewportHandle>();
  const renderRow = (item: StreamItem) => (
    <div data-message-id={item.id} style={ROW_STYLE}>
      {item.id}
    </div>
  );
  let props: StreamRenderInput = {
    agentId: "history-regression",
    segments: {
      historyVirtualized: messages(0, 150),
      historyMounted: messages(150, 20),
      liveHead: [],
    },
    boundary: { hasVirtualizedHistory: true, hasMountedHistory: true, hasLiveHead: false },
    renderers: {
      renderHistoryVirtualizedRow: renderRow,
      renderHistoryMountedRow: renderRow,
      renderLiveHeadRow: renderRow,
      renderLiveAuxiliary: () => null,
    },
    listEmptyComponent: null,
    viewportRef,
    routeBottomAnchorRequest: null,
    isAuthoritativeHistoryReady: true,
    onNearBottomChange: vi.fn(),
    onNearHistoryStart: vi.fn(),
    isLoadingOlderHistory: false,
    hasOlderHistory: false,
    scrollEnabled: true,
    messageParagraphSpacing: 8,
    conversationVerticalPadding: 16,
    listStyle: null,
    baseListContentContainerStyle: null,
    forwardListContentContainerStyle: null,
    ...input,
  };
  function render(patch: Partial<StreamRenderInput> = {}) {
    props = { ...props, ...patch };
    if (!root) throw new Error("测试视口尚未挂载");
    root.render(strategy.render(props));
  }
  render();
  return { render, viewportRef };
}

function viewport(): HTMLElement {
  const node = host.querySelector('[data-testid="agent-chat-scroll"]');
  if (!(node instanceof HTMLElement)) throw new Error("未找到历史滚动视口");
  return node;
}

function visibleAnchor(): { id: string; top: number } {
  const bounds = viewport().getBoundingClientRect();
  for (const node of host.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const box = node.getBoundingClientRect();
    const id = node.dataset.messageId;
    if (id && box.height > 0 && box.top >= bounds.top && box.top < bounds.bottom) {
      return { id, top: box.top - bounds.top };
    }
  }
  throw new Error("视口内没有可见历史消息");
}

describe("真实浏览器历史分页", () => {
  it("在顶部加载点继续向上滚动时仍可请求历史，无需先向下滚动", async () => {
    const onNearHistoryStart = vi.fn();
    const view = mountViewport({ hasOlderHistory: false, onNearHistoryStart });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 0;
    await nextLayout();
    view.render({ hasOlderHistory: true });
    await nextLayout();
    onNearHistoryStart.mockClear();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    await nextLayout();
    expect(onNearHistoryStart).toHaveBeenCalledTimes(1);
  });

  it("向前插入一页虚拟历史后保持原来正在阅读的消息位置", async () => {
    const view = mountViewport();
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 400;
    await nextLayout();
    const before = visibleAnchor();
    view.render({
      segments: {
        historyVirtualized: messages(-40, 190),
        historyMounted: messages(150, 20),
        liveHead: [],
      },
    });
    await nextLayout();
    expect(visibleAnchor()).toEqual(before);
  });

  it("隐藏后重新显示虚拟历史时不留下空白占位", async () => {
    mountViewport();
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 400;
    await nextLayout();
    host.style.display = "none";
    await nextLayout();
    host.style.display = "flex";
    await nextLayout();
    expect(visibleAnchor().top).toBeLessThanOrEqual(80);
  });

  it("补页把常驻消息移入虚拟区时仍保持阅读位置", async () => {
    const view = mountViewport({
      segments: { historyVirtualized: [], historyMounted: messages(0, 30), liveHead: [] },
      boundary: { hasVirtualizedHistory: false, hasMountedHistory: true, hasLiveHead: false },
    });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 64;
    await nextLayout();
    const before = visibleAnchor();
    view.render({
      segments: {
        historyVirtualized: messages(-40, 55),
        historyMounted: messages(15, 15),
        liveHead: [],
      },
      boundary: { hasVirtualizedHistory: true, hasMountedHistory: true, hasLiveHead: false },
    });
    await nextLayout();
    expect(visibleAnchor()).toEqual(before);
  });

  it("补页只推进游标而没有新增可见行时继续加载，不因相同画面卡住或无限重试", async () => {
    const onNearHistoryStart = vi.fn();
    const view = mountViewport({ onNearHistoryStart, historyStartCursor: "epoch:100" });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 0;
    await nextLayout();
    view.render({ hasOlderHistory: true });
    await nextLayout();
    expect(onNearHistoryStart).toHaveBeenCalledTimes(1);
    view.render({ historyStartCursor: "epoch:60" });
    await nextLayout();
    expect(onNearHistoryStart).toHaveBeenCalledTimes(2);
    view.render({ historyStartCursor: "epoch:60" });
    await nextLayout();
    expect(onNearHistoryStart).toHaveBeenCalledTimes(2);
  });

  it("虚拟历史尾部上方的消息重新测量时不把正文推成半屏空白", async () => {
    mountViewport();
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 14_000;
    await nextLayout();
    const before = visibleAnchor();
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-message-id]"));
    const index = rows.findIndex((row) => row.dataset.messageId === before.id);
    const preceding = rows[index - 2];
    if (!preceding) throw new Error("测试需要视口上方的已挂载消息");
    preceding.style.height = "700px";
    await nextLayout();
    await nextLayout();
    expect(visibleAnchor()).toEqual(before);
  });

  it("阅读常驻历史时仍保留浏览器对上方内容增高的锚定", async () => {
    mountViewport();
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 300;
    await nextLayout();
    const before = visibleAnchor();
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-message-id]"));
    const index = rows.findIndex((row) => row.dataset.messageId === before.id);
    const preceding = rows[index - 2];
    if (!preceding) throw new Error("测试需要视口上方的常驻消息");
    preceding.style.height = "700px";
    await nextLayout();
    await nextLayout();
    expect(visibleAnchor()).toEqual(before);
  });

  it("顶部翻页键可以加载，但消息内输入框的光标移动不会触发加载", async () => {
    const onNearHistoryStart = vi.fn();
    const view = mountViewport({ onNearHistoryStart });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 0;
    await nextLayout();
    view.render({ hasOlderHistory: true });
    await nextLayout();
    onNearHistoryStart.mockClear();
    const input = document.createElement("textarea");
    scroll.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(onNearHistoryStart).not.toHaveBeenCalled();
    scroll.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    expect(onNearHistoryStart).toHaveBeenCalledTimes(1);
    input.remove();
  });
});
