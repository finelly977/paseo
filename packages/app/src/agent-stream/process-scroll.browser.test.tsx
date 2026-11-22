import React, { createRef, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";
import { ProcessDisclosure } from "./process-disclosure";
import { selectProcessTransitionVisibleItemIds, useProcessExpansion } from "./process-expansion";

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

const LONG_TURN_PROCESS_ITEMS: StreamItem[] = Array.from({ length: 60 }, (_, index) => ({
  kind: "thought",
  id: `long-process-${index}`,
  text: `过程步骤 ${index}`,
  status: "ready",
  timestamp: new Date(index),
}));
const LONG_TURN_ANSWER: StreamItem = {
  kind: "assistant_message",
  id: "long-turn-answer",
  text: "最终回复正文",
  timestamp: new Date(1000),
};
const LONG_TURN_VIRTUAL = LONG_TURN_PROCESS_ITEMS.slice(0, 48);
const LONG_TURN_MOUNTED = [...LONG_TURN_PROCESS_ITEMS.slice(48), LONG_TURN_ANSWER];
const PROCESS_ITEM_STYLE = { height: 40 };
const TOGGLE_BUTTON_STYLE = { display: "block", height: 36, width: "100%" } as const;
const ANSWER_STYLE = { height: 220 };
const EMPTY_ID_SET = new Set<string>();

function LongProcessToggleHarness() {
  const strategy = useMemo(() => createWebStreamStrategy({ isMobileBreakpoint: false }), []);
  const viewportRef = useRef<StreamViewportHandle | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const expansion = useProcessExpansion("long-turn-test");
  const expanded = expansion.expandedTurnIds.has("turn-long");
  const retained = expansion.retainedTurnIds.has("turn-long");
  const transitioning = expansion.transitioningTurnIds.has("turn-long");
  const visibleTransitionIds = expansion.transitionVisibleItemIds.get("turn-long");

  const handleToggle = useCallback(() => {
    const visibleItemIds = selectProcessTransitionVisibleItemIds({
      action: expanded ? "collapse" : "expand",
      orderedItems: LONG_TURN_PROCESS_ITEMS,
      anchorItemId: "long-process-0",
      anchorNode: anchorRef.current,
      estimateHeight: () => 40,
    });
    viewportRef.current?.preserveScrollAnchor({
      itemId: "long-process-0",
      measure: (callback) => {
        const bounds = anchorRef.current?.getBoundingClientRect();
        callback(bounds && bounds.height > 0 ? bounds.top : null);
      },
      applyChange: () => expansion.toggle("turn-long", { visibleItemIds }),
    });
  }, [expanded, expansion]);

  const estimatedHeightById = useMemo(() => {
    const heights = new Map<string, number>();
    for (const item of LONG_TURN_PROCESS_ITEMS) {
      if (!retained) {
        heights.set(item.id, item.id === "long-process-0" ? 36 : 0);
      } else if (visibleTransitionIds && !visibleTransitionIds.has(item.id)) {
        heights.set(item.id, 0);
      }
    }
    return heights;
  }, [retained, visibleTransitionIds]);

  const transitioningProcessItemIds = useMemo(() => {
    if (!transitioning) return EMPTY_ID_SET;
    const ids = new Set<string>();
    for (const item of LONG_TURN_PROCESS_ITEMS) {
      if (estimatedHeightById.get(item.id) !== 0) ids.add(item.id);
    }
    return ids;
  }, [estimatedHeightById, transitioning]);

  const renderRow = useCallback(
    (item: StreamItem) => {
      if (item.id === LONG_TURN_ANSWER.id) {
        return (
          <div data-testid="long-turn-answer" style={ANSWER_STYLE}>
            最终回复正文
          </div>
        );
      }
      const disclosure = (
        <ProcessDisclosure expanded={expanded} transitioning={transitioning} estimatedHeight={40}>
          {() => <div style={PROCESS_ITEM_STYLE}>{item.id}</div>}
        </ProcessDisclosure>
      );
      if (item.id === "long-process-0") {
        return (
          <>
            <button
              ref={anchorRef}
              type="button"
              data-testid="long-process-toggle"
              style={TOGGLE_BUTTON_STYLE}
              onClick={handleToggle}
            >
              用时 12s
            </button>
            {disclosure}
          </>
        );
      }
      return disclosure;
    },
    [expanded, handleToggle, transitioning],
  );

  const processAnchorIdByItemId = useMemo(
    () => new Map([["long-process-0", "completed-process-turn-long"]]),
    [],
  );

  return (
    <>
      {strategy.render({
        agentId: "long-turn-test",
        segments: {
          historyVirtualized: LONG_TURN_VIRTUAL,
          historyMounted: LONG_TURN_MOUNTED,
          liveHead: [],
        },
        historyRowRevision: {
          contentById: EMPTY_ID_SET,
          displayStateById: expanded ? new Set(["long-process-0"]) : EMPTY_ID_SET,
          estimatedHeightById,
          processAnchorIdByItemId,
          transitioningProcessItemIds,
          globalDisplayState: false,
        },
        boundary: { hasVirtualizedHistory: true, hasMountedHistory: true, hasLiveHead: false },
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
        onNearHistoryStart: noAction,
        isLoadingOlderHistory: false,
        hasOlderHistory: false,
        scrollEnabled: true,
        messageParagraphSpacing: 12,
        listEmptyComponent: null,
        listStyle: {},
        baseListContentContainerStyle: {},
        forwardListContentContainerStyle: {},
      })}
    </>
  );
}

test("超长虚拟化过程展开首帧不因底部占位闪跳，收起不出现空白占位墙", async () => {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:800px;height:480px";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<LongProcessToggleHarness />);
    await expect
      .poll(() => host.querySelector('[data-testid="long-process-toggle"]'))
      .not.toBeNull();
    for (let frame = 0; frame < 6; frame++) await nextFrame();

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="long-process-toggle"]');
    const answer = host.querySelector<HTMLElement>('[data-testid="long-turn-answer"]');
    if (!toggle || !answer) throw new Error("缺少用时按钮或最终回复");
    const collapsedAnswerTop = answer.getBoundingClientRect().top;

    toggle.click();
    const expandSpacerHeights: number[] = [];
    const expandAnswerTops: number[] = [];
    for (let frame = 0; frame < 10; frame++) {
      await nextFrame();
      const spacer = host.querySelector<HTMLElement>('[data-virtual-spacer="end"]');
      expandSpacerHeights.push(spacer ? spacer.getBoundingClientRect().height : 0);
      expandAnswerTops.push(answer.getBoundingClientRect().top);
    }
    // 展开过渡期间底部虚拟占位始终为 0，回复单调下移，不出现先猛跳离屏又闪回的帧。
    expect(Math.max(...expandSpacerHeights)).toBe(0);
    for (let i = 1; i < expandAnswerTops.length; i++) {
      expect(expandAnswerTops[i]).toBeGreaterThanOrEqual(expandAnswerTops[i - 1] - 1);
    }

    for (let frame = 0; frame < 20; frame++) await nextFrame();
    // 展开落定后全部 60 条过程项已恢复进列表，总高度大幅超出首屏。
    expect(answer.getBoundingClientRect().top - collapsedAnswerTop).toBeGreaterThan(1500);

    toggle.click();
    const collapseSpacerHeights: number[] = [];
    const collapseAnswerTops: number[] = [];
    for (let frame = 0; frame < 14; frame++) {
      await nextFrame();
      const spacer = host.querySelector<HTMLElement>('[data-virtual-spacer="end"]');
      collapseSpacerHeights.push(spacer ? spacer.getBoundingClientRect().height : 0);
      collapseAnswerTops.push(answer.getBoundingClientRect().top);
    }
    // 收起首帧已裁掉屏外尾段，底部占位保持 0 且回复连续上升落回原位。
    expect(Math.max(...collapseSpacerHeights)).toBe(0);
    for (let i = 1; i < collapseAnswerTops.length; i++) {
      expect(collapseAnswerTops[i]).toBeLessThanOrEqual(collapseAnswerTops[i - 1] + 1);
    }
    expect(Math.abs(answer.getBoundingClientRect().top - collapsedAnswerTop)).toBeLessThan(1);
  } finally {
    root.unmount();
    host.remove();
  }
});
