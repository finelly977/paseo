import React, { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import { createWebStreamStrategy } from "./strategy-web";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import {
  processTimelineResponse,
  type ProcessTimelineResponseInput,
  type TimelineCursor,
} from "@/timeline/session-stream-reducers";
import { buildAgentStreamRenderModel } from "./model";

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
const LONG_ROW_STYLE = { padding: 8, fontSize: 16, lineHeight: "24px" };

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
    if (id && box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom) {
      return { id, top: box.top - bounds.top };
    }
  }
  throw new Error("视口内没有可见历史消息");
}

describe("真实浏览器历史分页", () => {
  it("连续补页时复用提供方标识的不同消息不串行渲染，也不产生重复节点或空白视口", async () => {
    const entries: ProcessTimelineResponseInput["payload"]["entries"] = [];
    for (let round = 0; round < 100; round++) {
      entries.push(
        {
          seqStart: round * 2 + 1,
          seqEnd: round * 2 + 1,
          provider: "codex",
          turnId: `turn-${round}`,
          timestamp: new Date(round * 1000).toISOString(),
          item: {
            type: "user_message",
            text: `用户 ${round}`,
            messageId: `native-user-${round % 5}`,
            clientMessageId: `submitted-${round}`,
          },
        },
        {
          seqStart: round * 2 + 2,
          seqEnd: round * 2 + 2,
          provider: "codex",
          turnId: `turn-${round}`,
          timestamp: new Date(round * 1000 + 1).toISOString(),
          item: {
            type: "assistant_message",
            text: `回复 ${round}`,
            messageId: `native-assistant-${round % 5}`,
          },
        },
      );
    }
    let tail: StreamItem[] = [];
    let cursor: TimelineCursor | undefined;
    const view = mountViewport();
    for (let page = 0; page < 5; page++) {
      const start = 160 - page * 40;
      const result = processTimelineResponse({
        currentTail: tail,
        currentHead: [],
        currentCursor: cursor,
        isInitializing: false,
        hasActiveInitDeferred: false,
        initRequestDirection: "tail",
        payload: {
          agentId: "browser-history",
          direction: page === 0 ? "tail" : "before",
          projection: "projected",
          reset: page === 0,
          epoch: "epoch",
          startCursor: { seq: start + 1 },
          endCursor: { seq: start + 40 },
          hasOlder: start > 0,
          hasNewer: false,
          error: null,
          entries: entries.slice(start, start + 40),
        },
      });
      tail = result.tail;
      cursor = result.cursor ?? undefined;
      const byId = new Map(tail.map((item) => [item.id, item]));
      expect(byId.size).toBe(tail.length);
      const row = (item: StreamItem) => {
        const displayed = byId.get(item.id);
        if (
          !displayed ||
          (displayed.kind !== "user_message" && displayed.kind !== "assistant_message")
        )
          throw new Error("缺少可显示历史消息");
        return (
          <div
            data-message-id={item.id}
            data-expected-text={
              item.kind === "user_message" || item.kind === "assistant_message" ? item.text : ""
            }
            style={ROW_STYLE}
          >
            {displayed.text}
          </div>
        );
      };
      const model = buildAgentStreamRenderModel({
        tail,
        head: [],
        agentStatus: "idle",
        platform: "web",
        isMobileBreakpoint: false,
      });
      view.render({
        segments: model.segments,
        boundary: model.boundary,
        renderers: {
          renderHistoryVirtualizedRow: row,
          renderHistoryMountedRow: row,
          renderLiveHeadRow: row,
          renderLiveAuxiliary: () => null,
        },
      });
      await nextLayout();
      const scroll = viewport();
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 }));
      scroll.scrollTop = 40;
      await nextLayout();
      const nodes = Array.from(host.querySelectorAll<HTMLElement>("[data-message-id]"));
      expect(nodes.length).toBeGreaterThan(0);
      expect(new Set(nodes.map((node) => node.dataset.messageId)).size).toBe(nodes.length);
      expect(nodes.map((node) => node.textContent)).toEqual(
        nodes.map((node) => node.dataset.expectedText),
      );
      expect(visibleAnchor().top).toBeLessThanOrEqual(80);
      for (let index = 1; index < nodes.length; index++) {
        expect(nodes[index].getBoundingClientRect().top).toBeGreaterThanOrEqual(
          nodes[index - 1].getBoundingClientRect().bottom,
        );
      }
    }
    expect(tail.filter((item) => item.kind === "user_message")).toHaveLength(100);
  });

  it("多次向上翻页后，长正文和收起行不重叠且保持阅读锚点", async () => {
    const renderRow = (item: StreamItem) => {
      const ordinal = Math.abs(Number(item.id.replace("message-", "")));
      if (ordinal % 4 === 0) return null;
      return (
        <div data-message-id={item.id} style={LONG_ROW_STYLE}>
          {`${item.id}：历史正文需要保持完整展示。`.repeat(10 + (ordinal % 7) * 15)}
        </div>
      );
    };
    const view = mountViewport({
      segments: {
        historyVirtualized: messages(0, 400),
        historyMounted: messages(400, 20),
        liveHead: [],
      },
      renderers: {
        renderHistoryVirtualizedRow: renderRow,
        renderHistoryMountedRow: renderRow,
        renderLiveHeadRow: renderRow,
        renderLiveAuxiliary: () => null,
      },
    });
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    for (let page = 1; page <= 6; page += 1) {
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
      scroll.scrollTop = 32;
      await nextLayout();
      const before = visibleAnchor();
      view.render({
        segments: {
          historyVirtualized: messages(-page * 40, 400 + page * 40),
          historyMounted: messages(400, 20),
          liveHead: [],
        },
      });
      await expect.poll(visibleAnchor).toEqual(before);
      const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-stream-row-id]"));
      const overlaps = rows
        .slice(1)
        .filter(
          (row, index) =>
            row.getBoundingClientRect().top < rows[index].getBoundingClientRect().bottom,
        );
      expect(overlaps.map((row) => row.dataset.streamRowId)).toEqual([]);
    }
  });

  it("历史正文异步增高时，相邻消息立即让位而不等待行高缓存更新", async () => {
    mountViewport();
    await expect.poll(() => host.querySelector('[data-testid="agent-chat-scroll"]')).not.toBeNull();
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 400;
    await nextLayout();
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-stream-row-id]"));
    const first = rows[0];
    const next = rows[1];
    if (!first || !next) throw new Error("测试需要相邻的虚拟历史行");
    const content = first.querySelector<HTMLElement>("[data-message-id]");
    if (!content) throw new Error("测试历史行缺少正文");
    content.style.height = "700px";
    expect(next.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      first.getBoundingClientRect().bottom,
    );
    await nextLayout();
    expect(next.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      first.getBoundingClientRect().bottom,
    );
  });

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
    await expect.poll(visibleAnchor).toEqual(before);
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
    await expect.poll(visibleAnchor).toEqual(before);
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
    await expect.poll(visibleAnchor).toEqual(before);
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
    await expect.poll(visibleAnchor).toEqual(before);
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
