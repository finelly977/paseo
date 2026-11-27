import React from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { RetainedPanel } from "@/components/retained-panel";
import { ConversationHistoryIndex } from "./history-index.web";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import { getStreamItemDomId } from "./history-index-model";

const VIEWPORT_REF = { current: null };
const BODY_STYLE = { height: 2000 };
const SHORT_ROW_STYLE = { height: 60 };
const TALL_REPLY_STYLE = { height: 1800 };
const SCROLL_STYLE = { height: 500, overflowY: "auto" as const };
const RETAINED_STAGE_STYLE = { position: "relative" as const, width: "100%", height: "700px" };

test("用户气泡离开虚拟窗口后，正文仍维持所属轮次的高亮", async () => {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "relative", width: "900px", height: "500px" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const entries: ConversationHistoryIndexEntry[] = [
    { id: "first", title: "第一轮", preview: "", sourceIndex: 0 },
    { id: "second", title: "第二轮", preview: "", sourceIndex: 1 },
  ];
  const owners = new Map([["long-process", entries[0]]]);
  try {
    root.render(
      <>
        <ConversationHistoryIndex
          entries={entries}
          itemOwners={owners}
          viewportRef={VIEWPORT_REF}
        />
        <div data-testid="agent-chat-scroll" style={SCROLL_STYLE}>
          <div id={getStreamItemDomId("long-process")} style={BODY_STYLE}>
            第一轮的长过程
          </div>
        </div>
      </>,
    );
    await expect
      .poll(() => host.querySelectorAll("[data-history-index]").length, { timeout: 5000 })
      .toBe(2);
    await expect
      .poll(() => host.querySelector('[data-history-index="0"][aria-current="step"]'))
      .not.toBeNull();
    const scroll = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!scroll) throw new Error("缺少滚动视口");
    scroll.scrollTop = 600;
    scroll.dispatchEvent(new Event("scroll"));
    await expect
      .poll(() => host.querySelector('[data-history-index="0"][aria-current="step"]'))
      .not.toBeNull();
    expect(host.querySelectorAll('[aria-current="step"]').length).toBe(1);
  } finally {
    root.unmount();
    host.remove();
  }
});

test("长会话只挂载可见刻度，滚动和键盘仍能访问全部历史", async () => {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "relative", width: "900px", height: "700px" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const entries: ConversationHistoryIndexEntry[] = Array.from({ length: 3000 }, (_, index) => ({
    id: `message-${index}`,
    title: `问题 ${index}`,
    preview: "回答",
    sourceIndex: index,
    seqStart: index + 1,
  }));
  const navigate = vi.fn();
  try {
    root.render(
      <ConversationHistoryIndex
        entries={entries}
        viewportRef={VIEWPORT_REF}
        onNavigate={navigate}
      />,
    );
    await expect.poll(() => host.querySelector('[data-history-index="2999"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="button"]').length).toBeLessThan(100);
    const rail = host.querySelector('[role="navigation"]');
    if (!(rail instanceof HTMLElement)) throw new Error("缺少历史导航");
    rail.scrollTop = 0;
    rail.dispatchEvent(new Event("scroll"));
    await expect.poll(() => host.querySelector('[data-history-index="0"]')).not.toBeNull();
    const first = host.querySelector('[data-history-index="0"]');
    if (!(first instanceof HTMLElement)) throw new Error("缺少第一轮刻度");
    first.click();
    expect(navigate).toHaveBeenLastCalledWith(entries[0]);
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await expect
      .poll(() => document.activeElement?.getAttribute("data-history-index"))
      .toBe("2999");
    expect(host.querySelectorAll('[role="button"]').length).toBeLessThan(100);
  } finally {
    root.unmount();
    host.remove();
  }
});

test("真实 Chromium 下从最新轻滚一格与隐藏保活恢复都不会跳回顶部对话", async () => {
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "relative",
    width: "900px",
    height: "700px",
    display: "flex",
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  const entries: ConversationHistoryIndexEntry[] = Array.from({ length: 80 }, (_, index) => ({
    id: `turn-${index}`,
    title: `问题 ${index}`,
    preview: `回答 ${index}`,
    sourceIndex: index,
    seqStart: index + 1,
  }));
  const expectedMaxScroll = 79 * 8 + 12 - 480;
  try {
    root.render(
      <RetainedPanel active>
        <div style={RETAINED_STAGE_STYLE}>
          <ConversationHistoryIndex entries={entries} viewportRef={VIEWPORT_REF} />
        </div>
      </RetainedPanel>,
    );
    await expect.poll(() => host.querySelector('[data-history-index="79"]')).not.toBeNull();
    const rail = host.querySelector('[role="navigation"]');
    if (!(rail instanceof HTMLElement)) throw new Error("缺少历史导航");
    await expect.poll(() => Math.round(rail.scrollTop)).toBe(expectedMaxScroll);

    // 模拟真实隐藏（display:none 会让 Chromium 重置 rail.scrollTop 为 0）再恢复可见
    root.render(
      <RetainedPanel active={false}>
        <div style={RETAINED_STAGE_STYLE}>
          <ConversationHistoryIndex entries={entries} viewportRef={VIEWPORT_REF} />
        </div>
      </RetainedPanel>,
    );
    await expect.poll(() => rail.clientHeight).toBe(0);

    root.render(
      <RetainedPanel active>
        <div style={RETAINED_STAGE_STYLE}>
          <ConversationHistoryIndex entries={entries} viewportRef={VIEWPORT_REF} />
        </div>
      </RetainedPanel>,
    );
    await expect.poll(() => Math.round(rail.scrollTop)).toBe(expectedMaxScroll);

    // 恢复后从最新位置向上轻滚一格标准滚轮（-100px），只应微调约 28px，不跳到顶部第 0 轮
    const wheel = new WheelEvent("wheel", {
      deltaY: -100,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    });
    rail.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    await expect.poll(() => Math.round(rail.scrollTop)).toBe(expectedMaxScroll - 28);
    expect(host.querySelector('[data-history-index="0"]')).toBeNull();
    expect(host.querySelector('[data-history-index="79"]')).not.toBeNull();
  } finally {
    root.unmount();
    host.remove();
  }
});

test("20 轮对话在最新超长回复处稍微上滚时，左侧索引保持停留在最新轮而非跳到第一个索引", async () => {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "relative", width: "900px", height: "600px" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const entries: ConversationHistoryIndexEntry[] = Array.from({ length: 20 }, (_, index) => ({
    // 模拟未加载首轮摘要与当前已挂载节点存在提供方复用 ID 的情况
    id: index === 0 ? "shared-provider-msg" : `turn-${index}`,
    title: `问题 ${index}`,
    preview: `回答 ${index}`,
    sourceIndex: index,
    seqStart: index * 10 + 1,
    ...(index === 19 ? { loadedId: "loaded-user-19" } : {}),
  }));
  const owners = new Map<string, ConversationHistoryIndexEntry>([
    ["turn-0-mounted", entries[0]!],
    ["shared-provider-msg", entries[19]!],
  ]);
  try {
    root.render(
      <>
        <ConversationHistoryIndex
          entries={entries}
          itemOwners={owners}
          viewportRef={VIEWPORT_REF}
        />
        <div data-testid="agent-chat-scroll" style={SCROLL_STYLE}>
          <div id={getStreamItemDomId("turn-0-mounted")} style={SHORT_ROW_STYLE}>
            第一轮
          </div>
          <div id={getStreamItemDomId("shared-provider-msg")} style={TALL_REPLY_STYLE}>
            最新第 20 轮的超长回复与表格
          </div>
        </div>
      </>,
    );
    await expect
      .poll(() => host.querySelectorAll("[data-history-index]").length, { timeout: 5000 })
      .toBe(20);
    const scroll = host.querySelector<HTMLElement>('[data-testid="agent-chat-scroll"]');
    if (!scroll) throw new Error("缺少滚动视口");

    // 先滚到最底部（最新记录）
    scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
    scroll.dispatchEvent(new Event("scroll"));
    await expect
      .poll(() => host.querySelector('[data-history-index="19"][aria-current="step"]'))
      .not.toBeNull();

    // 从最新记录往上滚一点点（离开贴底阈值，但视口仍在最新长回复内部，且其几何中心仍在 35% 参考线下方）
    scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight - 80);
    scroll.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(host.querySelector('[data-history-index="19"][aria-current="step"]')).not.toBeNull();
    expect(host.querySelector('[data-history-index="0"][aria-current="step"]')).toBeNull();
  } finally {
    root.unmount();
    host.remove();
  }
});
