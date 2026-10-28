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
const EXPANDED_ROW_STYLE = { height: 900, flexShrink: 0 };
const PROCESS_ROW_STYLE = { height: 40 };
const VARIABLE_ROW_STYLES = Array.from({ length: 5 }, (_, index) => ({ height: 73 + index * 61 }));
const SUBPIXEL_ROW_STYLES = Array.from({ length: 5 }, (_, index) => ({
  height: 73.2 + index * 61.17,
}));

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

it("在底部展开长过程时保持入口，而不是继续跟随最终回复", async () => {
  let expanded = false;
  let view: ReturnType<typeof mountViewport>;
  const toggle = vi.fn(() => {
    const handle = view.viewportRef.current;
    if (!handle) throw new Error("视口未就绪");
    handle.preserveScrollAnchor({
      itemId: "message-16",
      measure: (callback) => {
        const button = host.querySelector<HTMLButtonElement>("[data-process-toggle]");
        callback(button ? button.getBoundingClientRect().top : null);
      },
      applyChange: () => {
        expanded = !expanded;
        const changedRow = (item: StreamItem) => renderRow(item);
        view.render({
          renderers: {
            renderHistoryVirtualizedRow: changedRow,
            renderHistoryMountedRow: changedRow,
            renderLiveHeadRow: changedRow,
            renderLiveAuxiliary: () => null,
          },
        });
      },
    });
  });
  const renderRow = (item: StreamItem) => (
    <div
      data-message-id={item.id}
      style={item.id === "message-16" && expanded ? EXPANDED_ROW_STYLE : ROW_STYLE}
    >
      {item.id === "message-16" ? (
        <button type="button" data-process-toggle onClick={toggle}>
          已处理
        </button>
      ) : (
        item.id
      )}
    </div>
  );
  view = mountViewport({
    segments: { historyVirtualized: [], historyMounted: messages(0, 20), liveHead: [] },
    boundary: { hasVirtualizedHistory: false, hasMountedHistory: true, hasLiveHead: false },
    renderers: {
      renderHistoryVirtualizedRow: renderRow,
      renderHistoryMountedRow: renderRow,
      renderLiveHeadRow: renderRow,
      renderLiveAuxiliary: () => null,
    },
  });
  await expect.poll(() => host.querySelector("[data-process-toggle]")).not.toBeNull();
  await nextLayout();
  await nextLayout();
  const button = host.querySelector<HTMLButtonElement>("[data-process-toggle]");
  if (!button) throw new Error("缺少过程入口");
  const before = button.getBoundingClientRect().top;
  button.click();
  await expect
    .poll(() => host.querySelector<HTMLElement>('[data-message-id="message-16"]')?.offsetHeight)
    .toBe(900);
  await nextLayout();
  await nextLayout();
  await expect.poll(() => Math.abs(button.getBoundingClientRect().top - before)).toBeLessThan(1);
  button.click();
  await expect
    .poll(() => host.querySelector<HTMLElement>('[data-message-id="message-16"]')?.offsetHeight)
    .toBe(80);
  await nextLayout();
  await expect.poll(() => Math.abs(button.getBoundingClientRect().top - before)).toBeLessThan(1);
});

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
  it("虚拟窗口的占位使用已测量的小数行高，不逐行舍入", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={SUBPIXEL_ROW_STYLES[Math.abs(Number(item.id.slice(8))) % 5]}
      >
        {item.id}
      </div>
    );
    mountViewport({
      segments: {
        historyVirtualized: messages(0, 40),
        historyMounted: messages(40, 20),
        liveHead: [],
      },
      renderers: {
        renderHistoryVirtualizedRow: renderRow,
        renderHistoryMountedRow: renderRow,
        renderLiveHeadRow: renderRow,
        renderLiveAuxiliary: () => null,
      },
    });
    host.style.height = "20000px";
    await expect.poll(() => host.querySelectorAll("[data-message-id]").length).toBe(60);
    await nextLayout();
    const sizes = [...host.querySelectorAll<HTMLElement>("[data-message-id]")].map(
      (node) => node.getBoundingClientRect().height,
    );
    host.style.height = "480px";
    await nextLayout();
    const scroll = viewport();
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    scroll.scrollTop = 4000;
    await nextLayout();
    await nextLayout();
    const first = host.querySelector<HTMLElement>("[data-index]");
    if (!first || !first.parentElement) throw new Error("虚拟窗口没有行");
    const firstIndex = Number(first.dataset.index);
    expect(firstIndex).toBeGreaterThan(0);
    const expected = sizes.slice(0, firstIndex).reduce((sum, height) => sum + height, 0);
    expect(Number.parseFloat(first.parentElement.style.paddingTop)).toBeCloseTo(expected, 2);
  });

  it("连续滚动经过小数行高时，位置误差保持在一个设备像素以内", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={SUBPIXEL_ROW_STYLES[Math.abs(Number(item.id.slice(8))) % 5]}
      >
        {item.id}
      </div>
    );
    mountViewport({
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
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    scroll.scrollTop = 20_000;
    await nextLayout();
    await nextLayout();
    const errors: number[] = [];
    for (let step = 0; step < 50; step++) {
      const before = visibleAnchor();
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      const previousOffset = scroll.scrollTop;
      scroll.scrollTop -= 100;
      const moved = previousOffset - scroll.scrollTop;
      await nextLayout();
      const row = host.querySelector<HTMLElement>(`[data-message-id="${before.id}"]`);
      if (!row) throw new Error(`快速滚动丢失可见行 ${before.id}`);
      errors.push(
        Math.abs(
          row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - before.top - moved,
        ),
      );
    }
    // Chromium 在设备像素上取整 scrollTop，同一帧的多次窗口提交仍有至多一像素的舍入误差。
    expect(Math.max(...errors)).toBeLessThanOrEqual(1 / window.devicePixelRatio);
  });

  it("持续上滚经过未测量的长历史时，每次滚动只移动用户输入的距离", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={VARIABLE_ROW_STYLES[Math.abs(Number(item.id.slice(8))) % 5]}
      >
        {item.id}
      </div>
    );
    mountViewport({
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
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -35 }));
    scroll.scrollTop = 20_000;
    await nextLayout();
    await nextLayout();
    const shifts: number[] = [];
    for (let step = 0; step < 80; step++) {
      const before = visibleAnchor();
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -35 }));
      scroll.scrollTop -= 35;
      await nextLayout();
      const row = host.querySelector<HTMLElement>(`[data-message-id="${before.id}"]`);
      if (!row) throw new Error(`小幅滚动丢失了可见行 ${before.id}`);
      shifts.push(
        Math.round(
          row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - before.top - 35,
        ),
      );
    }
    expect(shifts).toEqual(Array.from({ length: 80 }, () => 0));
  });

  it("持续上滚时插入旧页，后续滚动仍按用户距离推进", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={VARIABLE_ROW_STYLES[Math.abs(Number(item.id.slice(8))) % 5]}
      >
        {item.id}
      </div>
    );
    const view = mountViewport({
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
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -35 }));
    scroll.scrollTop = 80;
    await nextLayout();
    view.render({ hasOlderHistory: true });
    await nextLayout();
    view.render({ isLoadingOlderHistory: true });
    await nextLayout();
    const shifts: number[] = [];
    for (let step = 0; step < 50; step++) {
      const before = visibleAnchor();
      const delta = Math.min(35, scroll.scrollTop);
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -35 }));
      scroll.scrollTop -= delta;
      await nextLayout();
      if (step === 1) {
        view.render({
          segments: {
            historyVirtualized: messages(-40, 190),
            historyMounted: messages(150, 20),
            liveHead: [],
          },
          hasOlderHistory: false,
          isLoadingOlderHistory: false,
        });
        await nextLayout();
      }
      const row = host.querySelector<HTMLElement>(`[data-message-id="${before.id}"]`);
      if (!row) throw new Error(`补页滚动丢失了可见行 ${before.id}`);
      shifts.push(
        Math.round(
          row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - before.top - delta,
        ),
      );
    }
    expect(shifts).toEqual(Array.from({ length: 50 }, () => 0));
  });

  it("阅读收起入口下方的长正文时，入口已离屏也能保留正文阅读位置", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={item.id === "message-0" ? EXPANDED_ROW_STYLE : ROW_STYLE}
      >
        {item.id === "message-0" ? (
          <div data-testid="completed-process-long-answer" style={PROCESS_ROW_STYLE}>
            已处理
          </div>
        ) : null}
        {item.id}
      </div>
    );
    const view = mountViewport({
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
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 80;
    await nextLayout();
    const before = visibleAnchor();
    expect(before.id).toBe("message-0");
    view.render({ hasOlderHistory: true });
    await nextLayout();
    view.render({ isLoadingOlderHistory: true });
    await nextLayout();
    view.render({
      segments: {
        historyVirtualized: messages(-40, 190),
        historyMounted: messages(150, 20),
        liveHead: [],
      },
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
    });
    const offsets: (number | null)[] = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const anchor = host.querySelector<HTMLElement>('[data-message-id="message-0"]');
      offsets.push(
        anchor ? anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top : null,
      );
    }
    expect(offsets).toEqual(Array.from({ length: 12 }, () => before.top));
  });

  it("补页占位高度连续修正时，不把中间错误位置绘制到屏幕", async () => {
    const renderRow = (item: StreamItem) => (
      <div
        data-message-id={item.id}
        style={VARIABLE_ROW_STYLES[Math.abs(Number(item.id.slice(8))) % 5]}
      >
        {item.id}
      </div>
    );
    const view = mountViewport({
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
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
    scroll.scrollTop = 32;
    await nextLayout();
    const before = visibleAnchor();
    view.render({ hasOlderHistory: true });
    await nextLayout();
    view.render({ isLoadingOlderHistory: true });
    await nextLayout();
    view.render({
      segments: {
        historyVirtualized: messages(-40, 190),
        historyMounted: messages(150, 20),
        liveHead: [],
      },
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
    });
    const offsets: (number | null)[] = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const anchor = host.querySelector<HTMLElement>(`[data-message-id="${before.id}"]`);
      offsets.push(
        anchor ? anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top : null,
      );
    }
    expect(offsets).toEqual(Array.from({ length: 12 }, () => before.top));
  });

  it.each([30, 170])(
    "初始 %i 项历史补页移动收起入口时，每一帧保留位置且不构建隐藏过程",
    async (total) => {
      let processHost = "message-0";
      const renderHiddenProcess = vi.fn();
      const renderRow = (item: StreamItem) => {
        if (item.id === processHost) {
          return (
            <div data-testid="completed-process-stable-turn" style={PROCESS_ROW_STYLE}>
              已处理
            </div>
          );
        }
        if (item.id === "message-0") renderHiddenProcess();
        return (
          <div data-message-id={item.id} style={ROW_STYLE}>
            {item.id}
          </div>
        );
      };
      const renderers = {
        renderHistoryVirtualizedRow: renderRow,
        renderHistoryMountedRow: renderRow,
        renderLiveHeadRow: renderRow,
        renderLiveAuxiliary: () => null,
      };
      const revision = (heights: ReadonlyMap<string, number>) => ({
        contentById: new Set<string>(),
        displayStateById: new Set<string>(),
        estimatedHeightById: heights,
        processAnchorIdByItemId: new Map([[processHost, "completed-process-stable-turn"]]),
        globalDisplayState: false,
      });
      const hidden = new Map<string, number>();
      const mountedStart = total - 20;
      const view = mountViewport({
        renderers,
        segments:
          total === 30
            ? { historyVirtualized: [], historyMounted: messages(0, total), liveHead: [] }
            : {
                historyVirtualized: messages(0, mountedStart),
                historyMounted: messages(mountedStart, 20),
                liveHead: [],
              },
        historyRowRevision: revision(hidden),
      });
      await expect
        .poll(() => host.querySelector('[data-testid="agent-chat-scroll"]'))
        .not.toBeNull();
      await nextLayout();
      const scroll = viewport();
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
      scroll.scrollTop = 0;
      await nextLayout();
      const offset = () => {
        const toggle = host.querySelector('[data-testid="completed-process-stable-turn"]');
        if (!toggle) return null;
        return toggle.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      };
      const before = offset();
      expect(before).toBe(16);
      for (let page = 1; page <= 4; page++) {
        view.render({ hasOlderHistory: true });
        await nextLayout();
        scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -80 }));
        view.render({ isLoadingOlderHistory: true });
        await nextLayout();
        hidden.set(processHost, 0);
        processHost = `message-${-page * 40}`;
        view.render({
          segments: {
            historyVirtualized: messages(-page * 40, mountedStart + page * 40),
            historyMounted: messages(mountedStart, 20),
            liveHead: [],
          },
          historyRowRevision: revision(new Map(hidden)),
          isLoadingOlderHistory: false,
          hasOlderHistory: false,
        });
        const offsets: (number | null)[] = [];
        for (let frame = 0; frame < 12; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          offsets.push(offset());
        }
        expect(offsets).toEqual(Array.from({ length: 12 }, () => before));
      }
      expect(renderHiddenProcess).not.toHaveBeenCalled();
    },
  );

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
