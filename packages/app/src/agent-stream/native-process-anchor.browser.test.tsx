import React, { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { View } from "react-native";
import { expect, test } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { NativeHistoryProcessItem, StreamItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "@/timeline/native-history-details";
import { presentNativeHistoryProcesses } from "@/timeline/native-history-presentation";
import { buildAgentStreamRenderModel } from "./model";
import { NativeHistoryProcess } from "./native-history-process";
import { createWebStreamStrategy } from "./strategy-web";
import type { StreamViewportHandle } from "./strategy";

const PROCESS: NativeHistoryProcessItem = {
  kind: "native_history_process",
  id: "native-process:long-turn",
  turnId: "long-turn",
  status: "completed",
  timestamp: new Date(1000),
  durationMs: 1874000,
  error: null,
  summaryMessageIds: [],
  summaryRevision: "summary",
};
const ITEMS: AgentTimelineItem[] = Array.from({ length: 1600 }, (_, index) => ({
  type: "assistant_message",
  messageId: `process-${index}`,
  text: `第 ${index} 条过程`,
}));
const DETAIL = {
  serverId: "host",
  agentId: "agent",
  turnId: PROCESS.turnId,
  revision: nativeHistoryDetailRevision(PROCESS),
  items: ITEMS,
  complete: true,
  loading: false,
  error: null,
  nextCursor: null,
};
const TAIL: StreamItem[] = [
  ...Array.from(
    { length: 18 },
    (_, index): StreamItem => ({
      kind: "user_message",
      id: `old-${index}`,
      text: `旧回合 ${index}`,
      timestamp: new Date(0),
    }),
  ),
  PROCESS,
  ...Array.from(
    { length: 4 },
    (_, index): StreamItem => ({
      kind: "assistant_message",
      id: `answer-${index}`,
      text: `最终回复 ${index}`,
      timestamp: new Date(2000),
    }),
  ),
];
const ROW_STYLE = { height: 80, flexShrink: 0 };
const CASES = [40, 200, 1600].map((count) => ({
  count,
  detail: { ...DETAIL, items: ITEMS.slice(0, count) },
}));
const strategy = createWebStreamStrategy({ isMobileBreakpoint: false });
function noAction() {}

function Harness({ detail }: { detail: typeof DETAIL }) {
  const viewport = useRef<StreamViewportHandle | null>(null);
  const [expanded, setExpanded] = useState(false);
  const anchors = useRef(new Map<string, View>());
  const registerAnchor = useCallback(({ turnId, node }: { turnId: string; node: View }) => {
    anchors.current.set(turnId, node);
    return () => {
      if (anchors.current.get(turnId) === node) anchors.current.delete(turnId);
    };
  }, []);
  const toggle = useCallback(({ turnId, itemId }: { turnId: string; itemId: string }) => {
    viewport.current?.preserveScrollAnchor({
      itemId,
      measure: (callback) => {
        const node = anchors.current.get(turnId);
        if (!node) {
          callback(null);
          return;
        }
        if (node instanceof HTMLElement) {
          const bounds = node.getBoundingClientRect();
          callback(bounds.height > 0 ? bounds.top : null);
          return;
        }
        node.measureInWindow((_x, top, _width, height) => callback(height > 0 ? top : null));
      },
      applyChange: () => setExpanded((value) => !value),
    });
  }, []);
  const tail = presentNativeHistoryProcesses({
    tail: TAIL,
    expandedTurnIds: new Set(expanded ? [PROCESS.turnId] : []),
    detailsByTurn: new Map([[PROCESS.turnId, detail]]),
  });
  const model = buildAgentStreamRenderModel({
    agentStatus: "idle",
    tail,
    head: [],
    platform: "web",
    isMobileBreakpoint: false,
  });
  const renderRow = (item: StreamItem) =>
    item.kind === "native_history_process" ? (
      <NativeHistoryProcess
        item={item}
        expanded={expanded}
        onToggle={toggle}
        registerAnchor={registerAnchor}
        viewport={viewport}
        client={null}
        serverId="host"
        agentId="agent"
        readId="read"
        gapAbove={0}
        gapBelow={12}
        dividerSpacing={8}
      />
    ) : (
      <div style={ROW_STYLE}>{item.id}</div>
    );
  return strategy.render({
    agentId: "agent",
    segments: model.segments,
    boundary: model.boundary,
    renderers: {
      renderHistoryVirtualizedRow: renderRow,
      renderHistoryMountedRow: renderRow,
      renderLiveHeadRow: renderRow,
      renderLiveAuxiliary: () => null,
    },
    viewportRef: viewport,
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
  });
}

test.each(CASES)(
  "$count 条原生过程跨常驻区与虚拟区展开收起，每一帧保持用时入口",
  async ({ detail }) => {
    const i18n = createInstance();
    await i18n.init({
      lng: "zh-CN",
      resources: {
        "zh-CN": {
          translation: {
            agentStream: { completedTurn: { processedFor: "用时 {{duration}}" } },
          },
        },
      },
    });
    const host = document.createElement("div");
    Object.assign(host.style, { display: "flex", width: "800px", height: "480px" });
    document.body.appendChild(host);
    const root = createRoot(host);
    useNativeHistoryDetails.setState({
      entries: new Map([[nativeHistoryDetailKey("host", "agent", "read", PROCESS.turnId), detail]]),
    });
    try {
      root.render(
        <I18nextProvider i18n={i18n}>
          <Harness detail={detail} />
        </I18nextProvider>,
      );
      const findToggle = () =>
        host.querySelector<HTMLElement>(
          `[data-testid="native-process-${PROCESS.turnId}"] [role="button"]`,
        );
      await expect.poll(findToggle).not.toBeNull();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const initial = findToggle();
      if (!initial) throw new Error("未挂载用时入口");
      const before = initial.getBoundingClientRect().top;
      initial.click();
      for (let frame = 0; frame < 24; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = findToggle();
        expect(current, `展开第 ${frame} 帧入口未挂载`).not.toBeNull();
        if (!current) throw new Error("入口离开虚拟窗口");
        expect(Math.abs(current.getBoundingClientRect().top - before)).toBeLessThan(1);
      }
      expect(host.querySelectorAll("[data-stream-row-id]").length).toBeLessThan(60);
      const expanded = findToggle();
      if (!expanded) throw new Error("展开后缺少入口");
      expanded.click();
      for (let frame = 0; frame < 12; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = findToggle();
        if (!current) throw new Error("收起后缺少入口");
        expect(Math.abs(current.getBoundingClientRect().top - before)).toBeLessThan(1);
      }
    } finally {
      root.unmount();
      host.remove();
      useNativeHistoryDetails.setState({ entries: new Map() });
    }
  },
);
