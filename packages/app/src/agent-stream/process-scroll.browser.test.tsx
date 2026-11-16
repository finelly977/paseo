import React, { createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import { createWebStreamStrategy } from "./strategy-web";
import { ProcessDisclosure } from "./process-disclosure";

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
