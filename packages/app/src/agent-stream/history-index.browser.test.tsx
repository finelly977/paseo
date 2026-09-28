import React from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ConversationHistoryIndex } from "./history-index.web";
import type { ConversationHistoryIndexEntry } from "./history-index-model";

const VIEWPORT_REF = { current: null };

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
