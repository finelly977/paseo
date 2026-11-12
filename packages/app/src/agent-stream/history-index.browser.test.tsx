import React from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ConversationHistoryIndex } from "./history-index.web";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import { getStreamItemDomId } from "./history-index-model";

const VIEWPORT_REF = { current: null };
const BODY_STYLE = { height: 2000 };
const SCROLL_STYLE = { height: 500, overflowY: "auto" as const };

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
