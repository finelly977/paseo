import React, { createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createNativeStreamStrategy } from "./strategy-native";
import type { StreamItem } from "@/types/stream";
import type { StreamRenderInput, StreamViewportHandle } from "./strategy";
import { renderCompletedProcessRow } from "./completed-process-row";

vi.mock("@/components/ui/button", () => ({ Button: () => null }));
const VIEW_STYLE = { flex: 1 };
const CONTENT_STYLE = { flexGrow: 1 };
const ROW_STYLE = { height: 40 };
const BODY_STYLE = { height: 400 };

it.each([0, 1600])("原生倒置列表展开 %s 个额外单元后恢复入口，收起后不累加空白", async (count) => {
  const host = document.createElement("div");
  Object.assign(host.style, { display: "flex", height: "600px", width: "800px" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const strategy = createNativeStreamStrategy();
  const handle = createRef<StreamViewportHandle>();
  const items: StreamItem[] = Array.from({ length: count + 6 }, (_, index) => ({
    kind: "assistant_message",
    id: `item-${index}`,
    text: `${index}`,
    timestamp: new Date(0),
  }));
  let expanded = false;
  const anchorId = `item-${count + 3}`;
  const heights = new Map(items.slice(3, count + 3).map((item) => [item.id, 0]));
  const toggle = vi.fn(() => {
    if (!handle.current) throw new Error("视口未挂载");
    handle.current.preserveScrollAnchor({
      itemId: anchorId,
      measure: (callback) => {
        const button = host.querySelector<HTMLElement>("[data-native-toggle]");
        callback(button ? button.getBoundingClientRect().top : null);
      },
      applyChange: () => {
        expanded = !expanded;
        render();
      },
    });
  });
  const renderRow = (item: StreamItem) => {
    if (item.id === anchorId)
      return renderCompletedProcessRow({
        order: "footer-then-content",
        toggle: (
          <button type="button" data-native-toggle onClick={toggle}>
            已处理
          </button>
        ),
        content: expanded ? (
          <div data-native-body style={BODY_STYLE}>
            第一条回复
          </div>
        ) : null,
      });
    return <div style={ROW_STYLE}>{item.id}</div>;
  };
  const render = () => {
    const input: StreamRenderInput = {
      agentId: "native-expansion",
      segments: { historyVirtualized: [], historyMounted: items, liveHead: [] },
      historyRowRevision: {
        contentById: new Set(),
        displayStateById: expanded ? new Set([anchorId]) : new Set(),
        estimatedHeightById: expanded ? new Map() : heights,
        globalDisplayState: false,
      },
      liveHeadRowRevision: null,
      boundary: { hasLiveHead: false, hasVirtualizedHistory: false, hasMountedHistory: true },
      renderers: {
        renderHistoryMountedRow: renderRow,
        renderHistoryVirtualizedRow: renderRow,
        renderLiveHeadRow: renderRow,
        renderLiveAuxiliary: () => null,
      },
      listEmptyComponent: null,
      viewportRef: handle,
      routeBottomAnchorRequest: null,
      isAuthoritativeHistoryReady: true,
      onNearBottomChange: vi.fn(),
      onNearHistoryStart: vi.fn(),
      isLoadingOlderHistory: false,
      hasOlderHistory: false,
      scrollEnabled: true,
      messageParagraphSpacing: 8,
      listStyle: VIEW_STYLE,
      baseListContentContainerStyle: CONTENT_STYLE,
      forwardListContentContainerStyle: null,
    };
    root.render(strategy.render(input));
  };
  try {
    render();
    await expect.poll(() => host.querySelector("[data-native-toggle]")).not.toBeNull();
    const before = host
      .querySelector<HTMLElement>("[data-native-toggle]")
      ?.getBoundingClientRect().top;
    host.querySelector<HTMLButtonElement>("[data-native-toggle]")?.click();
    await expect
      .poll(() => host.querySelector("[data-native-body]"), { timeout: 5000 })
      .not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await expect
      .poll(
        () => host.querySelector<HTMLElement>("[data-native-toggle]")?.getBoundingClientRect().top,
        { timeout: 5000 },
      )
      .toBe(before);
    host.querySelector<HTMLButtonElement>("[data-native-toggle]")?.click();
    await expect.poll(() => host.querySelector("[data-native-body]")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect
      .poll(
        () => host.querySelector<HTMLElement>("[data-native-toggle]")?.getBoundingClientRect().top,
      )
      .toBe(before);
  } finally {
    root.unmount();
    host.remove();
  }
});
