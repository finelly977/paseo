import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { ProcessDisclosure } from "./process-disclosure";
import { useProcessExpansion } from "./process-expansion";
import { ConversationDivider } from "@/components/conversation-divider";

const CONTENT_STYLE = { height: 120 };
function Harness() {
  const expansion = useProcessExpansion("conversation");
  const toggleExpansion = expansion.toggle;
  const expanded = expansion.expandedTurnIds.has("turn");
  const toggle = useCallback(() => toggleExpansion("turn"), [toggleExpansion]);
  return (
    <>
      <button type="button" onClick={toggle} aria-expanded={expanded}>
        用时
      </button>
      {expansion.retainedTurnIds.has("turn") && (
        <ProcessDisclosure
          estimatedHeight={120}
          expanded={expanded}
          transitioning={expansion.transitioningTurnIds.has("turn")}
        >
          {() => (
            <div style={CONTENT_STYLE} data-testid="process-source">
              过程正文
            </div>
          )}
        </ProcessDisclosure>
      )}
    </>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
test("用时过程逐行展开和收起，关闭后释放正文，快速重开不被旧计时器清空", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<Harness />);
    await expect.poll(() => host.querySelector("button")).not.toBeNull();
    const toggle = host.querySelector("button");
    if (!toggle) throw new Error("缺少用时入口");
    const height = () =>
      host.querySelector('[data-testid="process-disclosure"]')?.getBoundingClientRect().height ?? 0;
    expect(host.querySelector('[data-testid="process-source"]')).toBeNull();
    toggle.click();
    const opening: number[] = [];
    for (let frame = 0; frame < 22; frame++) {
      await nextFrame();
      opening.push(height());
    }
    expect(opening.some((value) => value > 0 && value < 120)).toBe(true);
    expect(height()).toBe(120);
    toggle.click();
    const closing: number[] = [];
    for (let frame = 0; frame < 16; frame++) {
      await nextFrame();
      closing.push(height());
    }
    expect(closing.some((value) => value > 0 && value < 120)).toBe(true);
    expect(host.querySelector('[data-testid="process-source"]')).toBeNull();
    toggle.click();
    await nextFrame();
    toggle.click();
    await nextFrame();
    toggle.click();
    for (let frame = 0; frame < 24; frame++) await nextFrame();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(height()).toBe(120);
  } finally {
    root.unmount();
    host.remove();
  }
});

test("用时与压缩分割线共用正文边界和上下留白", async () => {
  const host = document.createElement("div");
  Object.assign(host.style, { width: "738px", padding: "0 8px", boxSizing: "border-box" });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(
      <>
        <ConversationDivider spacing={12} labelPosition="above">
          <span>用时 2m 8s</span>
        </ConversationDivider>
        <ConversationDivider spacing={12} labelPosition="center">
          <span>上下文已压缩</span>
        </ConversationDivider>
      </>,
    );
    await expect
      .poll(() => host.querySelectorAll('[data-testid="conversation-divider"]').length)
      .toBe(2);
    const dividers = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="conversation-divider"]'),
    );
    const lines = dividers.map((divider) =>
      Array.from(
        divider.querySelectorAll<HTMLElement>('[data-testid="conversation-divider-line"]'),
      ),
    );
    expect(lines[0][0].getBoundingClientRect().left).toBe(lines[1][0].getBoundingClientRect().left);
    expect(lines[0][0].getBoundingClientRect().right).toBe(
      lines[1][1].getBoundingClientRect().right,
    );
    for (const divider of dividers) {
      expect(getComputedStyle(divider).paddingTop).toBe("12px");
      expect(getComputedStyle(divider).paddingBottom).toBe("12px");
    }
    for (const group of lines)
      for (const line of group) expect(line.getBoundingClientRect().height).toBe(1);
  } finally {
    root.unmount();
    host.remove();
  }
});

test("收起时新进入虚拟窗口的过程行只保留高度，不挂载工具正文", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(
      <ProcessDisclosure expanded={false} transitioning estimatedHeight={64}>
        {() => <div data-testid="unseen-tool">不应挂载</div>}
      </ProcessDisclosure>,
    );
    await expect.poll(() => host.getBoundingClientRect().height).toBe(64);
    expect(host.querySelector('[data-testid="unseen-tool"]')).toBeNull();
  } finally {
    root.unmount();
    host.remove();
  }
});
