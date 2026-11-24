import React, { createRef, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";
import { ProcessDisclosure } from "./process-disclosure";
import { useProcessExpansion } from "./process-expansion";
import { MOTION_DURATION } from "@/styles/motion";

const ROW_STYLE = { height: 120 };
const HISTORY: StreamItem[] = Array.from({ length: 220 }, (_, index) => ({
  kind: "assistant_message",
  id: `command-${index}`,
  text: `历史命令 ${index}`,
  timestamp: new Date(0),
}));
const VIRTUAL_HISTORY = HISTORY.slice(0, 200);
const MOUNTED_HISTORY = HISTORY.slice(200);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function noAction() {}
function historyRow(item: StreamItem) {
  return (
    <ProcessDisclosure expanded transitioning={false} estimatedHeight={120}>
      {() => (
        <div style={ROW_STYLE} data-history-command={item.id}>
          {item.id}
        </div>
      )}
    </ProcessDisclosure>
  );
}
function liveRow(item: StreamItem) {
  return <div style={ROW_STYLE}>{item.kind === "assistant_message" ? item.text : item.id}</div>;
}
function assertFullHeight(command: HTMLElement): string {
  const row = command.closest('[data-testid="process-disclosure"]');
  const id = command.dataset.historyCommand;
  if (!row || !id) throw new Error("命令未放入带标识的过程行");
  expect(row.getBoundingClientRect().height, id).toBe(120);
  return id;
}

test.each([390, 800])(
  "%i 像素视口持续回复时滚回历史过程，新挂载命令首帧完整且阅读位置稳定",
  async (width) => {
    const host = document.createElement("div");
    host.style.cssText = `display:flex;width:${width}px;height:480px`;
    document.body.appendChild(host);
    const root = createRoot(host);
    const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
    const viewportRef = createRef<StreamViewportHandle>();
    let revision = 0;
    const render = () => {
      const input: StreamRenderInput = {
        agentId: "streaming-with-expanded-history",
        segments: {
          historyVirtualized: VIRTUAL_HISTORY,
          historyMounted: MOUNTED_HISTORY,
          liveHead: [
            {
              kind: "assistant_message",
              id: "live-reply",
              text: `正在运行中的回复 ${revision++}`,
              timestamp: new Date(1000),
            },
          ],
        },
        boundary: { hasVirtualizedHistory: true, hasMountedHistory: true, hasLiveHead: true },
        renderers: {
          renderHistoryVirtualizedRow: historyRow,
          renderHistoryMountedRow: historyRow,
          renderLiveHeadRow: liveRow,
          renderLiveAuxiliary: () => null,
        },
        viewportRef,
        routeBottomAnchorRequest: null,
        isAuthoritativeHistoryReady: true,
        onNearBottomChange: noAction,
        onNearHistoryStart: noAction,
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
      root.render(strategy.render(input));
    };
    try {
      render();
      await expect
        .poll(() => host.querySelector('[data-testid="agent-chat-scroll"]'))
        .not.toBeNull();
      const viewport = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
      if (!viewport) throw new Error("缺少对话滚动视口");
      for (let frame = 0; frame < 18; frame++) await nextFrame();
      const seen = new Set<string>();
      for (const offset of [3000, 800, 6000, 1600]) {
        viewport.scrollTop = offset;
        for (let frame = 0; frame < 8; frame++) {
          await nextFrame();
          render();
          const commands = host.querySelectorAll<HTMLElement>("[data-history-command]");
          expect(commands.length).toBeLessThan(60);
          for (const command of commands) {
            seen.add(assertFullHeight(command));
          }
        }
        const bounds = viewport.getBoundingClientRect();
        const visible = Array.from(host.querySelectorAll<HTMLElement>("[data-history-command]"));
        const anchor = visible.find((row) => {
          const top = row.getBoundingClientRect().top;
          return top >= bounds.top && top < bounds.bottom;
        });
        if (!anchor) throw new Error("滚动后没有可读的历史命令");
        const anchorTop = anchor.getBoundingClientRect().top;
        render();
        for (let frame = 0; frame < 8; frame++) {
          await nextFrame();
          expect(anchor.isConnected).toBe(true);
          expect(Math.abs(anchor.getBoundingClientRect().top - anchorTop)).toBeLessThan(1);
        }
      }
      expect(seen.size).toBeGreaterThan(40);
    } finally {
      root.unmount();
      host.remove();
    }
  },
);

const PROCESS_COUNT = 720;
const LONG_PROCESS: StreamItem[] = Array.from({ length: PROCESS_COUNT }, (_, index) => {
  const common = { id: `long-process-${index}`, timestamp: new Date(index), turnId: "turn-long" };
  if (index % 3 === 0)
    return { ...common, kind: "thought", text: `推理 ${index}`, status: "ready" };
  if (index % 3 === 1)
    return {
      ...common,
      kind: "tool_call",
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: common.id,
          name: "shell",
          status: "completed",
          error: null,
          detail: { type: "shell", command: `command ${index}` },
        },
      },
    };
  return { ...common, kind: "assistant_message", text: `说明 ${index}` };
});
const LONG_ANSWER: StreamItem = {
  kind: "assistant_message",
  id: "long-answer",
  text: "最终回复",
  timestamp: new Date(1000),
};
const AFTER_ROWS = HISTORY.slice(200, 202);
const ANCHOR_ITEM = LONG_PROCESS[0].id;
const SHORT_PROCESS = LONG_PROCESS.slice(0, 3);
const PROCESS_STYLES = [24, 53, 132, 41, 37, 208].map((height) => ({ height }));
const ANCHOR_STYLE = { display: "block", height: 30, width: "100%" } as const;
const ANSWER_STYLE = { height: 110 } as const;
const EARLY_REPLY_STYLE = { height: 44 } as const;
const EMPTY_ID_SET = new Set<string>();
const PROCESS_ANCHOR_BY_ID = new Map([[ANCHOR_ITEM, "completed-process-turn-long"]]);
const EARLIER_PROCESS: StreamItem[] = Array.from({ length: 24 }, (_, index) => ({
  kind: "thought",
  text: `早期过程 ${index}`,
  timestamp: new Date(index),
  status: "ready",
  turnId: "turn-long",
  id: `earlier-process-${index}`,
}));

function LongProcessToggleHarness({
  middle,
  compact,
  prepend = false,
  short = false,
  earlyReply = false,
  nearBottom = false,
  onNearHistoryStart,
}: {
  middle: boolean;
  compact: boolean;
  prepend?: boolean;
  short?: boolean;
  earlyReply?: boolean;
  nearBottom?: boolean;
  onNearHistoryStart?: () => void;
}) {
  const strategy = useMemo(
    () => createWebStreamStrategy({ isMobileBreakpoint: compact }),
    [compact],
  );
  const viewportRef = useRef<StreamViewportHandle | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { expandedTurnIds, toggle } = useProcessExpansion("long-turn-test");
  const expanded = expandedTurnIds.has("turn-long");
  const items = short ? SHORT_PROCESS : LONG_PROCESS;
  const anchorItemId = prepend ? EARLIER_PROCESS[0].id : ANCHOR_ITEM;
  const handleToggle = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) throw new Error("缺少过程滚动视口");
    viewport.preserveScrollAnchor({
      itemId: anchorItemId,
      process: { turnId: "turn-long", expanded: !expanded },
      measure: (callback) => callback(anchorRef.current?.getBoundingClientRect().top ?? null),
      applyChange: () => toggle("turn-long"),
    });
  }, [anchorItemId, expanded, toggle]);
  const estimatedHeightById = useMemo(
    () =>
      expanded
        ? new Map()
        : new Map(
            (prepend ? [...EARLIER_PROCESS, ...items] : items).map((item) => [
              item.id,
              item.id === anchorItemId ? 30 : 0,
            ]),
          ),
    [anchorItemId, expanded, items, prepend],
  );
  const segments = useMemo(() => {
    const previousCount = middle ? 90 : 5;
    const precedingTurns = middle || nearBottom ? HISTORY.slice(0, previousCount) : [];
    const before = prepend ? EARLIER_PROCESS : precedingTurns;
    const after = middle ? AFTER_ROWS : [];
    return compact || short
      ? {
          historyVirtualized: [],
          historyMounted: [...before, ...items, LONG_ANSWER, ...after],
          liveHead: [],
        }
      : {
          historyVirtualized: [...before, ...items.slice(0, -11)],
          historyMounted: [...items.slice(-11), LONG_ANSWER, ...after],
          liveHead: [],
        };
  }, [compact, middle, items, nearBottom, prepend, short]);
  const renderRow = useCallback(
    (item: StreamItem) => {
      if (item.id === LONG_ANSWER.id)
        return (
          <div style={ANSWER_STYLE} data-long-answer>
            最终回复
          </div>
        );
      if (!item.id.startsWith("long-process-") && !item.id.startsWith("earlier-process-")) {
        return <div style={ROW_STYLE}>{item.id}</div>;
      }
      const bodyStyle =
        PROCESS_STYLES[Number(item.id.slice(item.id.lastIndexOf("-") + 1)) % PROCESS_STYLES.length];
      const detail = (
        <ProcessDisclosure
          turnId="turn-long"
          expanded={expanded}
          transitioning={false}
          estimatedHeight={40}
        >
          {() => (
            <div data-body-height={bodyStyle.height} style={bodyStyle}>
              {item.id}
            </div>
          )}
        </ProcessDisclosure>
      );
      if (item.id !== anchorItemId) return detail;
      return (
        <>
          <button
            ref={anchorRef}
            type="button"
            aria-expanded={expanded}
            data-testid="completed-process-turn-long"
            data-long-toggle
            style={ANCHOR_STYLE}
            onClick={handleToggle}
          >
            用时
          </button>
          {earlyReply && (
            <div style={EARLY_REPLY_STYLE} data-early-reply>
              提前给出的回复
            </div>
          )}
          {detail}
        </>
      );
    },
    [anchorItemId, earlyReply, expanded, handleToggle],
  );
  const processAnchorIdByItemId = useMemo(
    () =>
      prepend ? new Map([[anchorItemId, "completed-process-turn-long"]]) : PROCESS_ANCHOR_BY_ID,
    [anchorItemId, prepend],
  );

  return strategy.render({
    agentId: "long-turn-test",
    segments,
    historyRowRevision: {
      contentById: EMPTY_ID_SET,
      displayStateById: EMPTY_ID_SET,
      estimatedHeightById,
      processAnchorIdByItemId,
      virtualizeExpandedProcess: compact && expanded,
      globalDisplayState: compact,
    },
    boundary: {
      hasVirtualizedHistory: !compact && !short,
      hasMountedHistory: true,
      hasLiveHead: false,
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
    onNearBottomChange: noAction,
    onNearHistoryStart: onNearHistoryStart ?? noAction,
    isLoadingOlderHistory: false,
    hasOlderHistory: onNearHistoryStart !== undefined,
    scrollEnabled: true,
    messageParagraphSpacing: 12,
    listEmptyComponent: null,
    listStyle: null,
    baseListContentContainerStyle: null,
    forwardListContentContainerStyle: null,
  });
}

test.each([
  { width: 800, middle: false, compact: false },
  { width: 800, middle: true, compact: false },
  { width: 390, middle: false, compact: true },
])(
  "720 条混合过程开合时无二次占位跳变，动作前后保留用时入口：%j",
  async ({ width, middle, compact }) => {
    const host = document.createElement("div");
    host.style.cssText = `display:flex;width:${width}px;height:480px`;
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      root.render(<LongProcessToggleHarness middle={middle} compact={compact} />);
      await expect.poll(() => host.querySelector("[data-long-toggle]")).not.toBeNull();
      const viewport = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
      const toggle = host.querySelector<HTMLButtonElement>("[data-long-toggle]");
      if (!viewport || !toggle) throw new Error("缺少用时入口或滚动视口");
      await nextFrame();
      await nextFrame();
      const top = toggle.getBoundingClientRect().top;
      const collapsedHeight = viewport.scrollHeight;
      toggle.click();
      await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
      // 一旦展开提交，完整尾段已经计入滚动范围，而不是 200 ms 后突然补入。
      expect(viewport.scrollHeight - collapsedHeight).toBeGreaterThan(16_000);
      const committedHeight = viewport.scrollHeight;
      const first = host.querySelector('[data-testid="process-disclosure"]');
      if (!first) throw new Error("开合提交未挂载过程首行");
      for (let frame = 0; frame < 22; frame++) {
        await nextFrame();
        expect(toggle.isConnected).toBe(true);
        expect(first.isConnected).toBe(true);
        expect(Math.abs(toggle.getBoundingClientRect().top - top)).toBeLessThan(1);
        expect(Math.abs(viewport.scrollHeight - committedHeight)).toBeLessThan(4000);
        const bodies = viewport.querySelectorAll<HTMLElement>("[data-body-height]");
        expect(bodies.length).toBeGreaterThan(4);
        expect(bodies.length).toBeLessThan(100);
        for (const body of bodies) {
          const process = body.closest('[data-testid="process-disclosure"]');
          expect(process?.getBoundingClientRect().height).toBe(Number(body.dataset.bodyHeight));
        }
      }
      toggle.click();
      await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
      expect(viewport.querySelector("[data-body-height]")).toBeNull();
      expect(Math.abs(viewport.scrollHeight - collapsedHeight)).toBeLessThan(2);
      expect(Math.abs(toggle.getBoundingClientRect().top - top)).toBeLessThan(1);
    } finally {
      root.unmount();
      host.remove();
    }
  },
);

function readProcessMotion(host: HTMLElement) {
  const deck = host.querySelector<HTMLElement>("[data-process-motion]");
  const full = deck?.children[0];
  const folded = deck?.children[1];
  const mask = full?.getAnimations()[0];
  const slide = folded?.getAnimations()[0];
  if (!deck || !full || !folded || !mask || !slide) return null;
  return { deck, full, folded, mask, slide };
}

function motionBoundary(slide: Animation) {
  const effect = slide.effect;
  if (!(effect instanceof KeyframeEffect) || !effect.target) throw new Error("缺少位移图层");
  return new DOMMatrixReadOnly(getComputedStyle(effect.target).transform).m42;
}

test.each([
  { width: 800, middle: false, compact: false, short: true, earlyReply: true },
  { width: 800, middle: false, compact: false, short: false, nearBottom: true },
  { width: 800, middle: true, compact: false, short: false, earlyReply: false },
  { width: 390, middle: false, compact: true, short: false, earlyReply: false },
])("用时双向揭示保持共同边界，快速反向接续当前位置：%j", async (scenario) => {
  const host = document.createElement("div");
  host.style.cssText = `display:flex;width:${scenario.width}px;height:480px`;
  document.body.appendChild(host);
  const root = createRoot(host);
  const motion = () => readProcessMotion(host);
  try {
    root.render(<LongProcessToggleHarness {...scenario} />);
    await expect.poll(() => host.querySelector("[data-long-toggle]")).not.toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>("[data-long-toggle]");
    const scroll = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!scroll || !toggle) throw new Error("缺少用时入口或滚动视口");
    await nextFrame();
    await nextFrame();
    const top = toggle.getBoundingClientRect().top;
    const originalAnswer = scroll.querySelector("[data-long-answer]");
    if (!originalAnswer) throw new Error("折叠状态下没有可读的最终回复");
    const foldedAnswerTop = originalAnswer.getBoundingClientRect().top;
    toggle.click();
    await expect.poll(() => motion()?.slide.playbackRate, { interval: 2 }).toBe(1);
    const open = motion();
    if (!open) throw new Error("展开没有启动空间动效");
    expect(open.deck.closest("[inert]")).not.toBeNull();
    expect(getComputedStyle(scroll).overflowAnchor).toBe("none");
    expect(open.full.querySelector("[data-body-height]")).not.toBeNull();
    expect(open.folded.querySelector("[data-long-answer]")).not.toBeNull();
    expect(open.deck.querySelector("[data-stream-row-id], [data-testid]")).toBeNull();
    expect(Number(open.mask.startTime) - Number(open.slide.startTime)).toBe(0);
    if (scenario.earlyReply) {
      const reply = scroll.querySelector("[data-early-reply]");
      if (!reply) throw new Error("缺少先于过程的回复");
      expect(open.deck.getBoundingClientRect().top).toBeCloseTo(
        reply.getBoundingClientRect().bottom,
        0,
      );
    }

    // 固定到中间帧再立即逆转，慢机器也能验证实际绘制层在同一位置续跑。
    for (const animation of [open.mask, open.slide]) {
      animation.pause();
      animation.currentTime = MOTION_DURATION.base / 2;
    }
    const midpoint = motionBoundary(open.slide);
    const clipAtMidpoint = getComputedStyle(open.full).clipPath;
    expect(midpoint).toBeGreaterThan(12);
    expect(midpoint).toBeLessThan(open.deck.clientHeight - 12);
    const hidden = /([\d.]+)%/.exec(clipAtMidpoint)?.[1];
    if (hidden === undefined) throw new Error("缺少裁剪边界");
    const revealed = open.deck.getBoundingClientRect().height * (1 - Number(hidden) / 100);
    expect(revealed).toBeCloseTo(midpoint, 0);
    if (scenario.short) {
      const expandedAnswerTop = originalAnswer.getBoundingClientRect().top;
      open.slide.currentTime = MOTION_DURATION.base;
      expect(motionBoundary(open.slide)).toBeCloseTo(expandedAnswerTop - foldedAnswerTop, 0);
      open.slide.currentTime = MOTION_DURATION.base / 2;
    }
    const height = scroll.scrollHeight;
    const openTop = toggle.getBoundingClientRect().top;
    expect(openTop).toBeCloseTo(top, 0);
    toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    toggle.click();
    await expect.poll(() => motion()?.slide.playbackRate, { interval: 2 }).toBeLessThan(0);
    expect(motion()?.deck).toBe(open.deck);
    if (!scenario.short) expect(scroll.scrollHeight).toBeLessThan(height);
    expect(scroll.querySelector("[data-body-height]")).toBeNull();
    const reversing = motionBoundary(open.slide);
    expect(reversing).toBeLessThanOrEqual(midpoint + 2);
    expect(reversing).toBeGreaterThan(0);
    toggle.click();
    await expect.poll(() => motion()?.slide.playbackRate, { interval: 2 }).toBe(1);
    expect(motion()?.deck).toBe(open.deck);
    await expect.poll(motion).toBeNull();
    expect(toggle.getBoundingClientRect().top).toBeCloseTo(top, 0);

    toggle.click();
    await expect.poll(() => motion()?.slide.playbackRate, { interval: 2 }).toBeLessThan(0);
    expect(motion()?.full.querySelector("[data-body-height]")).not.toBeNull();
    expect(motion()?.folded.querySelector("[data-long-answer]")).not.toBeNull();
    expect(scroll.querySelector("[data-body-height]")).toBeNull();
    await expect.poll(motion).toBeNull();
    expect(toggle.getBoundingClientRect().top).toBeCloseTo(top, 0);
    expect(scroll.querySelector("[data-long-answer]")?.getBoundingClientRect().top).toBeCloseTo(
      foldedAnswerTop,
      0,
    );
  } finally {
    root.unmount();
    host.remove();
  }
});

test("减少动态效果时直接开合，不盖住正文", async () => {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:800px;height:480px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const matchMedia = window.matchMedia.bind(window);
  const preference = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = matchMedia(query);
    if (query === "(prefers-reduced-motion: reduce)") {
      Object.defineProperty(media, "matches", { value: true });
    }
    return media;
  });
  try {
    root.render(<LongProcessToggleHarness middle={false} compact={false} short />);
    await expect.poll(() => host.querySelector("[data-long-toggle]")).not.toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>("[data-long-toggle]");
    if (!toggle) throw new Error("缺少用时入口");
    for (const expanded of ["true", "false"]) {
      toggle.click();
      await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe(expanded);
      expect(readProcessMotion(host)).toBeNull();
    }
  } finally {
    root.unmount();
    preference.mockRestore();
    host.remove();
  }
});

test.each(["滚轮", "滚动条"])("顶边展开不自动翻页；用%s主动补页时保留已读过程行", async (input) => {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:800px;height:480px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const onNearHistoryStart = vi.fn();
  try {
    root.render(<LongProcessToggleHarness middle={false} compact={false} />);
    await expect.poll(() => host.querySelector("[data-long-toggle]")).not.toBeNull();
    const scroll = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    const toggle = host.querySelector<HTMLButtonElement>("[data-long-toggle]");
    if (!scroll || !toggle) throw new Error("缺少用时入口或滚动视口");
    toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    root.render(
      <LongProcessToggleHarness
        middle={false}
        compact={false}
        onNearHistoryStart={onNearHistoryStart}
      />,
    );
    for (let frame = 0; frame < 10; frame++) await nextFrame();
    expect(onNearHistoryStart).not.toHaveBeenCalled();
    expect(scroll.scrollTop).toBe(0);
    const bodyTop = () =>
      host
        .querySelector('[data-stream-row-id="long-process-0"] [data-process-turn-id]')
        ?.getBoundingClientRect().top;
    const previousTop = bodyTop();
    if (previousTop === undefined) throw new Error("缺少已经在读的过程首行");
    if (input === "滚轮") {
      scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -220 }));
    } else {
      scroll.scrollTop = 60;
      await nextFrame();
      await nextFrame();
      expect(onNearHistoryStart).not.toHaveBeenCalled();
      scroll.dispatchEvent(new PointerEvent("pointerdown"));
      scroll.scrollTop = 0;
      await expect.poll(() => onNearHistoryStart.mock.calls.length).toBe(1);
      scroll.dispatchEvent(new PointerEvent("pointerup"));
    }
    expect(onNearHistoryStart).toHaveBeenCalledOnce();
    root.render(
      <LongProcessToggleHarness
        middle={false}
        compact={false}
        prepend
        onNearHistoryStart={onNearHistoryStart}
      />,
    );
    await expect.poll(() => scroll.scrollTop).toBeGreaterThan(500);
    await expect.poll(() => bodyTop()).toBeCloseTo(previousTop, 0);
  } finally {
    root.unmount();
    host.remove();
  }
});
