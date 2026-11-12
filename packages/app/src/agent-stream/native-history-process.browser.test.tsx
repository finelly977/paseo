import React, { createRef, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { NativeHistoryProcessItem, StreamItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
  type NativeHistoryDetails,
} from "@/timeline/native-history-details";
import { presentNativeHistoryProcesses } from "@/timeline/native-history-presentation";
import { ConversationDivider } from "@/components/conversation-divider";
import { ProcessDisclosure } from "./process-disclosure";
import { useProcessExpansion } from "./process-expansion";
import { NativeHistoryProcess } from "./native-history-process";
import type { StreamViewportHandle } from "./strategy";

let root: Root | null = null;
let host: HTMLDivElement;
const PROCESS: NativeHistoryProcessItem = {
  kind: "native_history_process",
  id: "native-process:turn",
  turnId: "turn",
  status: "completed",
  timestamp: new Date(1000),
  durationMs: 11000,
  error: null,
  summaryMessageIds: [],
  summaryRevision: "summary",
};
const viewport = createRef<StreamViewportHandle>();
function registerAnchor() {
  return () => undefined;
}
const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    resources: {
      "zh-CN": {
        translation: {
          agentStream: { completedTurn: { processed: "用时", processedFor: "用时 {{duration}}" } },
        },
      },
    },
  });
});
afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  useNativeHistoryDetails.setState({ entries: new Map() });
});
function Harness({ item }: { item: NativeHistoryProcessItem }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return (
    <NativeHistoryProcess
      item={item}
      client={null}
      agentId="agent"
      serverId="host"
      readId="read"
      expanded={expanded}
      onToggle={toggle}
      registerAnchor={registerAnchor}
      viewport={viewport}
      gapAbove={0}
      gapBelow={12}
      dividerSpacing={8}
    />
  );
}
function mount(item: NativeHistoryProcessItem, content?: React.ReactNode) {
  useNativeHistoryDetails.setState({
    entries: new Map([
      [
        nativeHistoryDetailKey("host", "agent", "read", "turn"),
        {
          serverId: "host",
          agentId: "agent",
          turnId: "turn",
          revision: nativeHistoryDetailRevision(item),
          items: [],
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
  root.render(<I18nextProvider i18n={i18n}>{content ?? <Harness item={item} />}</I18nextProvider>);
}
test.each(["completed", "interrupted", "failed"] as const)(
  "%s 回合只显示真实用时，不暴露已中断标题",
  async (status) => {
    mount({ ...PROCESS, status });
    await vi.waitFor(() => expect(host.textContent).toBe("用时 11s"));
    expect(host.textContent).not.toContain("已中断");
    expect(host.textContent).not.toContain("已处理");
  },
);
test("过程入口只切换状态，不创建包住文字与命令的内部滚动视口", async () => {
  mount(PROCESS);
  await vi.waitFor(() => expect(host.querySelector('[role="button"]')).not.toBeNull());
  const button = host.querySelector<HTMLElement>('[role="button"]');
  if (!button) throw Error("缺少用时入口");
  button.click();
  await vi.waitFor(() =>
    expect(host.querySelector('[role="button"]')?.getAttribute("aria-expanded")).toBe("true"),
  );
  expect(host.querySelector('[data-testid="native-process-details-turn"]')).toBeNull();
  expect(host.getBoundingClientRect().height).toBeLessThan(100);
  const current = host.querySelector<HTMLElement>('[role="button"]');
  if (!current) throw Error("缺少展开后的用时入口");
  current.click();
  await vi.waitFor(() =>
    expect(host.querySelector('[role="button"]')?.getAttribute("aria-expanded")).toBe("false"),
  );
});

const FINAL_REPLY: StreamItem = {
  kind: "assistant_message",
  id: "final",
  text: "最终回复始终可见",
  timestamp: new Date(12000),
};
const COMPACTION_DETAILS: NativeHistoryDetails = {
  serverId: "host",
  agentId: "agent",
  turnId: "turn",
  revision: "summary",
  nextCursor: null,
  complete: true,
  loading: false,
  error: null,
  items: [
    { type: "compaction", compactionId: "first", status: "completed" },
    { type: "compaction", compactionId: "second", status: "completed" },
  ],
};
const COMPACTION_TAIL = [PROCESS, FINAL_REPLY];
const COMPACTION_MAP = new Map([["turn", COMPACTION_DETAILS]]);

function CompactionHarness() {
  const expansion = useProcessExpansion("compaction-regression");
  const toggle = expansion.toggle;
  const onToggle = useCallback(({ turnId }: { turnId: string }) => toggle(turnId), [toggle]);
  const expanded = expansion.expandedTurnIds.has("turn");
  const tail = useMemo(
    () =>
      presentNativeHistoryProcesses({
        tail: COMPACTION_TAIL,
        expandedTurnIds: expansion.retainedTurnIds,
        detailsByTurn: COMPACTION_MAP,
      }),
    [expansion.retainedTurnIds],
  );
  return (
    <>
      {tail.map((item) => {
        if (item.kind === "native_history_process")
          return (
            <NativeHistoryProcess
              key={item.id}
              item={item}
              client={null}
              agentId="agent"
              serverId="host"
              readId="read"
              expanded={expanded}
              onToggle={onToggle}
              registerAnchor={registerAnchor}
              viewport={viewport}
              gapAbove={0}
              gapBelow={0}
              dividerSpacing={8}
            />
          );
        if (item.kind === "compaction") {
          const marker = (
            <ConversationDivider spacing={8} labelPosition="center">
              <span data-testid="completed-compaction">上下文已压缩</span>
            </ConversationDivider>
          );
          return item.nativeProcessDetail ? (
            <ProcessDisclosure
              key={item.id}
              expanded={expanded}
              transitioning={expansion.transitioningTurnIds.has("turn")}
              estimatedHeight={48}
            >
              {() => marker}
            </ProcessDisclosure>
          ) : (
            <React.Fragment key={item.id}>{marker}</React.Fragment>
          );
        }
        return <p key={item.id}>最终回复始终可见</p>;
      })}
    </>
  );
}

test("已完成压缩线默认收起，随用时动画展开、收起和再次展开，最终回复不隐藏", async () => {
  mount(PROCESS, <CompactionHarness />);
  const compactions = () => host.querySelectorAll('[data-testid="completed-compaction"]');
  const findButton = () =>
    host.querySelector<HTMLElement>('[data-testid="native-process-turn"] [role="button"]');
  await expect.poll(findButton).not.toBeNull();
  const button = findButton();
  if (!button) throw new Error("缺少用时入口");
  expect(compactions().length).toBe(0);
  expect(host.textContent).toContain("最终回复始终可见");
  button.click();
  await expect.poll(() => compactions().length).toBe(2);
  await expect
    .poll(() =>
      host.querySelector('[data-testid="process-disclosure"]')?.getAttribute("aria-hidden"),
    )
    .toBe("false");
  button.click();
  await expect.poll(() => compactions().length).toBe(0);
  expect(host.textContent).toContain("最终回复始终可见");
  button.click();
  await expect.poll(() => compactions().length).toBe(2);
});

test("过程分割线之后保留消息布局给定的间距", async () => {
  mount(PROCESS);
  await vi.waitFor(() => expect(host.textContent).toBe("用时 11s"));
  const process = host.querySelector<HTMLElement>('[data-testid="native-process-turn"]');
  if (!process) throw new Error("缺少过程行");
  expect(getComputedStyle(process).marginBottom).toBe("12px");
});
test("没有原生耗时的回合不补造零秒", async () => {
  mount({ ...PROCESS, durationMs: null, status: "interrupted" });
  await vi.waitFor(() => expect(host.textContent).toBe("用时"));
});
test("进行中的回合不显示历史用时入口", async () => {
  mount({ ...PROCESS, status: "inProgress" });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).toBe("");
  expect(host.getBoundingClientRect().height).toBe(0);
});
