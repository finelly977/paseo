import React, { createRef, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { page } from "vitest/browser";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { NativeHistoryProcessItem } from "@/types/stream";
import { isAgentToolCallItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "@/timeline/native-history-details";
import { NativeHistoryProcess } from "./native-history-process";
import type { StreamLayoutItem } from "./layout";
import type { StreamViewportHandle } from "./strategy";

let root: Root | null = null;
let host: HTMLDivElement;
const ROW_STYLE = { height: 32, flexShrink: 0 };
const EXPANDED_ROW_STYLE = { height: 600, flexShrink: 0 };
const PROCESS_ITEM: NativeHistoryProcessItem = {
  kind: "native_history_process",
  id: "native-process:turn",
  turnId: "turn",
  status: "interrupted",
  timestamp: new Date(1000),
  durationMs: 11000,
  error: null,
  summaryMessageIds: ["question"],
  summaryRevision: "summary",
};
const PROCESS_LAYOUT: StreamLayoutItem = {
  item: PROCESS_ITEM,
  index: 0,
  items: [PROCESS_ITEM],
  aboveItem: null,
  belowItem: null,
  gapAbove: 0,
  gapBelow: 0,
  assistantSpacing: "default",
  completedFooter: null,
  toolSequence: "none",
  isFirstInUserGroup: false,
  isLastInUserGroup: false,
  isLastInToolSequence: false,
  frameOrder: "content-then-footer",
  phase: "complete",
};
const ACTIVE_PROCESS: NativeHistoryProcessItem = { ...PROCESS_ITEM, status: "inProgress" };
const VIEWPORT = createRef<StreamViewportHandle>();
function renderTestRow(row: StreamLayoutItem) {
  return <TestRow layout={row} />;
}
function TestRow({ layout }: { layout: StreamLayoutItem }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const command = isAgentToolCallItem(layout.item) ? layout.item.payload.data.callId : "";
  return (
    <div
      data-process-row={layout.item.id}
      data-command={command}
      style={expanded ? EXPANDED_ROW_STYLE : ROW_STYLE}
    >
      <button type="button" data-expand-command onClick={toggle}>
        {layout.item.id}
      </button>
    </div>
  );
}
function renderTestReply() {
  return (
    <div data-process-reply style={ROW_STYLE}>
      中断前的最后说明
    </div>
  );
}
const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: "zh-CN", resources: {} });
});
afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  useNativeHistoryDetails.setState({ entries: new Map() });
});

function mount(count: number, item: NativeHistoryProcessItem = PROCESS_ITEM) {
  const items: AgentTimelineItem[] = Array.from({ length: count }, (_, index) => ({
    type: "tool_call",
    name: "Shell",
    callId: `command-${index}`,
    status: "completed",
    error: null,
    detail: { type: "shell", command: `命令 ${index + 1}`, output: "完成", exitCode: 0 },
  }));
  items.push({ type: "assistant_message", messageId: "partial", text: "中断前的最后说明" });
  useNativeHistoryDetails.setState({
    entries: new Map([
      [
        nativeHistoryDetailKey("host", "agent", "read", "turn"),
        {
          serverId: "host",
          agentId: "agent",
          turnId: "turn",
          revision: nativeHistoryDetailRevision(item),
          items,
          nextCursor: null,
          complete: true,
          loading: false,
          error: null,
        },
      ],
    ]),
  });
  host = document.createElement("div");
  host.style.width = "800px";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <I18nextProvider i18n={i18n}>
      <NativeHistoryProcess
        item={item}
        client={null}
        agentId="agent"
        serverId="host"
        readId="read"
        layout={PROCESS_LAYOUT}
        viewport={VIEWPORT}
        renderItem={renderTestRow}
        renderReply={renderTestReply}
      />
    </I18nextProvider>,
  );
}

test.each([1, 7])("展开 %s 条命令后正文紧随列表，没有固定高度留白", async (count) => {
  mount(count);
  await vi.waitFor(() => expect(host.querySelector('[role="button"],button')).not.toBeNull());
  const button = host.querySelector<HTMLElement>('[role="button"],button');
  if (!button) throw new Error("缺少过程入口");
  button.click();
  await vi.waitFor(() => expect(host.querySelectorAll("[data-process-row]").length).toBe(count));
  await vi.waitFor(() => {
    const rows = host.querySelectorAll("[data-process-row]");
    const reply = host.querySelector("[data-process-reply]");
    if (!reply) throw new Error("缺少中断说明");
    const gap = reply.getBoundingClientRect().top - rows[count - 1].getBoundingClientRect().bottom;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
  });
  await page.screenshot({
    element: host,
    path: `../../../../.output/process-layout-audit/${count}-commands.png`,
  });
  button.click();
  await vi.waitFor(() => expect(host.querySelectorAll("[data-process-row]")).toHaveLength(0));
  expect(host.getBoundingClientRect().height).toBeLessThan(120);
});

test("长过程保留有界视口和虚拟化，不一次挂载全部命令", async () => {
  mount(1000);
  await vi.waitFor(() => expect(host.querySelector('[role="button"],button')).not.toBeNull());
  const button = host.querySelector<HTMLElement>('[role="button"],button');
  if (!button) throw new Error("缺少过程入口");
  button.click();
  await vi.waitFor(() =>
    expect(host.querySelectorAll("[data-process-row]").length).toBeGreaterThan(0),
  );
  expect(host.querySelectorAll("[data-process-row]").length).toBeLessThan(250);
  expect(host.getBoundingClientRect().height).toBeLessThan(550);
  const viewport = host.querySelector<HTMLElement>('[data-testid="native-process-details-turn"]');
  if (!viewport) throw new Error("缺少有界过程视口");
  await vi.waitFor(
    () => {
      viewport.scrollTop = viewport.scrollHeight;
      expect(host.querySelector('[data-command="command-999"]')).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );
  expect(host.querySelectorAll("[data-process-row]").length).toBeLessThan(250);
}, 15000);

test("活动回合不渲染历史过程标题、折叠按钮或固定高度容器", async () => {
  mount(1, ACTIVE_PROCESS);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).toBe("");
  expect(host.getBoundingClientRect().height).toBe(0);
});

test("展开命令详情后视口有上限，收起详情后立即恢复短内容高度", async () => {
  mount(1);
  await vi.waitFor(() => expect(host.querySelector('[role="button"],button')).not.toBeNull());
  const toggle = host.querySelector<HTMLElement>('[role="button"],button');
  if (!toggle) throw new Error("缺少过程入口");
  toggle.click();
  await vi.waitFor(() => expect(host.querySelector("[data-expand-command]")).not.toBeNull());
  const command = host.querySelector<HTMLButtonElement>("[data-expand-command]");
  const viewport = host.querySelector<HTMLElement>('[data-testid="native-process-details-turn"]');
  if (!command || !viewport) throw new Error("缺少命令行或视口");
  command.click();
  await vi.waitFor(() => expect(viewport.clientHeight).toBe(400));
  expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  command.click();
  await vi.waitFor(() => expect(viewport.clientHeight).toBe(32));
});

test("空过程不保留空列表视口", async () => {
  mount(0);
  await vi.waitFor(() => expect(host.querySelector('[role="button"],button')).not.toBeNull());
  const toggle = host.querySelector<HTMLElement>('[role="button"],button');
  if (!toggle) throw new Error("缺少过程入口");
  toggle.click();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(host.querySelector('[data-testid="native-process-details-turn"]')).toBeNull();
  expect(host.getBoundingClientRect().height).toBeLessThan(120);
});
