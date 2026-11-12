import React, { createRef, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { NativeHistoryProcessItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "@/timeline/native-history-details";
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
    />
  );
}
function mount(item: NativeHistoryProcessItem) {
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
  root.render(
    <I18nextProvider i18n={i18n}>
      <Harness item={item} />
    </I18nextProvider>,
  );
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
