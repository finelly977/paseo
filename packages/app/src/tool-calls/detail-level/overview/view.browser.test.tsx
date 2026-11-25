import React, { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, expect, test, vi } from "vitest";
import { DisclosureContent } from "@/components/ui/disclosure";
import { zhCN } from "@/i18n/resources/zh-CN";
import type { ProcessRunItem } from "../grouping";
import { buildOverviewGroup } from "./model";

vi.mock("./sheet", () => ({
  OverviewToolCallGroupSheet: () => null,
}));

vi.mock("@/components/message", () => ({
  ProcessGroupListProvider: ({ children }: { children: React.ReactNode }) => children,
  ExpandableBadge: ({
    testID,
    label,
    isExpanded,
    onToggle,
    renderDetails,
  }: {
    testID?: string;
    label: string;
    isExpanded: boolean;
    onToggle?: () => void;
    renderDetails?: () => React.ReactNode;
  }) => (
    <div data-testid={testID}>
      <button type="button" data-group-toggle aria-expanded={isExpanded} onClick={onToggle}>
        {label}
      </button>
      {renderDetails ? (
        <DisclosureContent expanded={isExpanded} testID="expandable-badge-content">
          {renderDetails}
        </DisclosureContent>
      ) : null}
    </div>
  ),
}));

import { OverviewToolCallGroupView, TOOL_CALL_GROUP_MAX_HEIGHT } from "./view";

const ROW_STYLE = { height: 32, lineHeight: "32px" } as const;
const DETAIL_STYLE = { height: 180 } as const;
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    resources: {
      "zh-CN": {
        translation: {
          toolCallGroup: zhCN.toolCallGroup,
        },
      },
    },
  });
});

function makeStep(index: number): ProcessRunItem {
  if (index % 2 === 0) {
    return {
      kind: "thought",
      id: `step-${index}`,
      text: `思考步骤 ${index}`,
      status: "ready",
      timestamp: new Date(1000 + index * 1000),
    };
  }
  return {
    kind: "tool_call",
    id: `step-${index}`,
    timestamp: new Date(1000 + index * 1000),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: `step-${index}`,
        name: "shell",
        status: "completed",
        error: null,
        detail: { type: "shell", command: `echo step-${index}` },
      },
    },
  };
}

function ProcessGroupHarness({
  initialCount,
  onRenderItem,
}: {
  initialCount: number;
  onRenderItem: () => void;
}) {
  const [calls, setCalls] = useState<ProcessRunItem[]>(() =>
    Array.from({ length: initialCount }, (_, index) => makeStep(index)),
  );
  const [expanded, setExpanded] = useState(true);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);

  const group = useMemo(() => {
    const first = calls[0];
    const latest = calls.at(-1);
    if (!first || !latest) throw new Error("测试分组不能为空");
    return buildOverviewGroup({
      id: first.id,
      calls,
      latest,
      isSealed: false,
    });
  }, [calls]);

  const handleExpandedChange = useCallback((_groupId: string, next: boolean) => {
    setExpanded(next);
  }, []);

  const appendStep = useCallback(() => {
    setCalls((previous) => [...previous, makeStep(previous.length)]);
  }, []);

  const toggleFirstDetail = useCallback(() => {
    setExpandedDetailId((previous) => (previous === "step-0" ? null : "step-0"));
  }, []);

  const [unrelatedTick, setUnrelatedTick] = useState(0);
  const triggerUnrelatedRender = useCallback(() => {
    setUnrelatedTick((previous) => previous + 1);
  }, []);

  const renderItem = useCallback(
    (entry: ProcessRunItem) => {
      onRenderItem();
      return (
        <div data-process-step={entry.id}>
          <div style={ROW_STYLE}>{entry.id}</div>
          {expandedDetailId === entry.id ? (
            <div data-step-detail={entry.id} style={DETAIL_STYLE}>
              展开的详细内容
            </div>
          ) : null}
        </div>
      );
    },
    [expandedDetailId, onRenderItem],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <div data-unrelated-tick={unrelatedTick}>
        <button type="button" data-append-step onClick={appendStep}>
          追加步骤
        </button>
        <button type="button" data-toggle-detail onClick={toggleFirstDetail}>
          展开首条详情
        </button>
        <button type="button" data-unrelated-render onClick={triggerUnrelatedRender}>
          无关刷新
        </button>
        <OverviewToolCallGroupView
          group={group}
          executionActive
          expanded={expanded}
          isLastInSequence
          onExpandedChange={handleExpandedChange}
          renderItem={renderItem}
        />
      </div>
    </I18nextProvider>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
let renderItemCalls = 0;
function recordRenderItemCall() {
  renderItemCalls += 1;
}

test("过程折叠汇总思考与命令、高度受限、新增步骤动态滑至底部且上翻或展开详情不回拉", async () => {
  const host = document.createElement("div");
  host.style.cssText = "width:680px;height:760px;padding:16px";
  document.body.appendChild(host);
  const root = createRoot(host);
  renderItemCalls = 0;

  try {
    root.render(<ProcessGroupHarness initialCount={20} onRenderItem={recordRenderItemCall} />);
    await expect
      .poll(() => host.querySelector('[data-testid="tool-call-group-scroll"]'))
      .not.toBeNull();

    const toggle = host.querySelector<HTMLButtonElement>("[data-group-toggle]");
    const mask = host.querySelector<HTMLElement>('[data-testid="tool-call-group-mask"]');
    const scroll = host.querySelector<HTMLElement>('[data-testid="tool-call-group-scroll"]');
    const appendButton = host.querySelector<HTMLButtonElement>("[data-append-step]");
    const toggleDetailButton = host.querySelector<HTMLButtonElement>("[data-toggle-detail]");
    if (!toggle || !mask || !scroll || !appendButton || !toggleDetailButton) {
      throw new Error("缺少过程折叠标题、遮罩、滚动容器或操作按钮");
    }

    // 标题同时汇总命令数与思考次数。
    expect(toggle.textContent).toContain("运行了 10 个命令");
    expect(toggle.textContent).toContain("思考了 10 次");

    // 展开高度受最大高度上限约束，并在打开时滑至最新条目且顶部呈现柔和渐变淡出。
    expect(scroll.clientHeight).toBeLessThanOrEqual(TOOL_CALL_GROUP_MAX_HEIGHT);
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    await expect
      .poll(() => scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop, { timeout: 3000 })
      .toBeLessThanOrEqual(16);
    await expect.poll(() => mask.getAttribute("data-scroll-fade")).toBe("top");
    expect(mask.style.maskImage).toContain("linear-gradient");

    // 追加新步骤时自动滑动追尾到最新步骤。
    appendButton.click();
    await expect.poll(() => host.querySelector('[data-process-step="step-20"]')).not.toBeNull();
    await expect
      .poll(() => scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop, { timeout: 3000 })
      .toBeLessThanOrEqual(16);

    // 读者主动向上滚动到中部时上下两端淡出，且继续追加步骤不回拉到底部。
    scroll.scrollTop = 24;
    scroll.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await expect.poll(() => mask.getAttribute("data-scroll-fade")).toBe("both");
    const scrolledOffset = scroll.scrollTop;
    appendButton.click();
    await expect.poll(() => host.querySelector('[data-process-step="step-21"]')).not.toBeNull();
    for (let frame = 0; frame < 6; frame++) await nextFrame();
    expect(scroll.scrollTop).toBeLessThanOrEqual(scrolledOffset + 4);

    // 展开单条详情只增加内容高度，不触发追尾回拉。
    const beforeDetailHeight = scroll.scrollHeight;
    toggleDetailButton.click();
    await expect.poll(() => host.querySelector('[data-step-detail="step-0"]')).not.toBeNull();
    expect(scroll.scrollHeight).toBeGreaterThan(beforeDetailHeight);
    for (let frame = 0; frame < 6; frame++) await nextFrame();
    expect(scroll.scrollTop).toBeLessThanOrEqual(scrolledOffset + 4);

    // 滚到最顶部时仅底部呈现淡出，顶行完整清晰。
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event("scroll"));
    await expect.poll(() => mask.getAttribute("data-scroll-fade")).toBe("bottom");

    // 读者滚回底部后，顶部重新淡出，再追加新步骤重新恢复追尾。
    scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
    scroll.dispatchEvent(new Event("scroll"));
    await expect.poll(() => mask.getAttribute("data-scroll-fade")).toBe("top");
    await nextFrame();
    appendButton.click();
    await expect.poll(() => host.querySelector('[data-process-step="step-22"]')).not.toBeNull();
    await expect
      .poll(() => scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop, { timeout: 3000 })
      .toBeLessThanOrEqual(16);

    // 父级无关刷新不会击穿过程分组缓存或重跑子项渲染。
    const unrelatedButton = host.querySelector<HTMLButtonElement>("[data-unrelated-render]");
    const wrapper = host.querySelector<HTMLElement>("[data-unrelated-tick]");
    if (!unrelatedButton || !wrapper) {
      throw new Error("缺少无关刷新测试节点");
    }
    const countBeforeUnrelated = renderItemCalls;
    unrelatedButton.click();
    await expect.poll(() => wrapper.dataset.unrelatedTick).toBe("1");
    expect(renderItemCalls).toBe(countBeforeUnrelated);

    // 点击标题可收起与重新展开，动画结束后清理 animating 标记。
    const disclosure = host.querySelector<HTMLElement>('[data-testid="expandable-badge-content"]');
    toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(() => disclosure?.hasAttribute("data-disclosure-animating")).toBe(false);
    toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => disclosure?.hasAttribute("data-disclosure-animating")).toBe(false);
  } finally {
    root.unmount();
    host.remove();
  }
});
