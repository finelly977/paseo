import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { ProcessDisclosure } from "./process-disclosure";
import { useProcessExpansion } from "./process-expansion";
import { ConversationDivider } from "@/components/conversation-divider";
import { DisclosureContent } from "@/components/ui/disclosure";

const CONTENT_STYLE = { height: 120 };
const DIVIDER_LABEL_STYLE = { lineHeight: "24px" };
const NESTED_TOGGLE_STYLE = { display: "block", boxSizing: "border-box", height: 24 } as const;

function NestedDisclosureHarness() {
  const [expanded, setExpanded] = React.useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return (
    <DisclosureContent expanded testID="parent-process">
      {() => (
        <>
          <button type="button" onClick={toggle} style={NESTED_TOGGLE_STYLE}>
            展开子命令
          </button>
          <DisclosureContent expanded={expanded} testID="child-command">
            {() => <div style={CONTENT_STYLE}>命令输出</div>}
          </DisclosureContent>
        </>
      )}
    </DisclosureContent>
  );
}

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

function SettledProcessHarness() {
  const [visible, setVisible] = React.useState(false);
  const toggle = useCallback(() => setVisible((value) => !value), []);
  return (
    <>
      <button type="button" onClick={toggle}>
        显示已展开的历史
      </button>
      {visible && (
        <ProcessDisclosure expanded transitioning={false} estimatedHeight={120}>
          {() => <div style={CONTENT_STYLE}>历史命令</div>}
        </ProcessDisclosure>
      )}
    </>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
test("子命令展开收起时父层跟随自然高度，不叠加第二次高度动画", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<NestedDisclosureHarness />);
    await expect.poll(() => host.querySelector("button")).not.toBeNull();
    for (let frame = 0; frame < 18; frame++) await nextFrame();
    const toggle = host.querySelector("button");
    const parent = host.querySelector('[data-testid="parent-process"]');
    const child = host.querySelector('[data-testid="child-command"]');
    if (!toggle || !parent || !child) throw new Error("缺少嵌套命令");
    for (let round = 0; round < 2; round++) {
      toggle.click();
      for (let frame = 0; frame < 18; frame++) {
        await nextFrame();
        const parentHeight = parent.getBoundingClientRect().height;
        const childHeight = child.getBoundingClientRect().height;
        expect(
          Math.abs(parentHeight - childHeight - 24),
          `第 ${round} 次点击第 ${frame} 帧`,
        ).toBeLessThan(1);
      }
    }
  } finally {
    root.unmount();
    host.remove();
  }
});

test("已展开的历史重新进入视口时首帧保持完整高度，不重播展开动画", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<SettledProcessHarness />);
    await expect.poll(() => host.querySelector("button")).not.toBeNull();
    const toggle = host.querySelector("button");
    if (!toggle) throw new Error("缺少显示历史入口");
    for (let round = 0; round < 2; round++) {
      toggle.click();
      for (let frame = 0; frame < 12; frame++) {
        await nextFrame();
        const viewport = host.querySelector('[data-testid="process-disclosure"]');
        if (!viewport) throw new Error("缺少历史过程视口");
        expect(viewport.getBoundingClientRect().height, `第 ${round} 次挂载第 ${frame} 帧`).toBe(
          120,
        );
      }
      toggle.click();
      await nextFrame();
    }
  } finally {
    root.unmount();
    host.remove();
  }
});

test("点击用时后首帧挂载正文，第二帧已经展开，不额外空等一帧", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<Harness />);
    await expect.poll(() => host.querySelector("button")).not.toBeNull();
    const toggle = host.querySelector("button");
    if (!toggle) throw new Error("缺少用时入口");
    toggle.click();
    await nextFrame();
    expect(host.querySelector('[data-testid="process-source"]')).not.toBeNull();
    await nextFrame();
    const viewport = host.querySelector('[data-testid="process-disclosure"]');
    if (!viewport) throw new Error("缺少过程视口");
    expect(viewport.getBoundingClientRect().height).toBeGreaterThan(0);
  } finally {
    root.unmount();
    host.remove();
  }
});

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

test.each([390, 738].flatMap((width) => [0, 4, 12].map((spacing) => ({ width, spacing }))))(
  "分割线尊重实际留白设置：%j",
  async ({ width, spacing }) => {
    const host = document.createElement("div");
    Object.assign(host.style, { width: `${width}px`, padding: "0 8px", boxSizing: "border-box" });
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      root.render(
        <>
          <ConversationDivider spacing={spacing} labelPosition="above">
            <span style={DIVIDER_LABEL_STYLE}>用时 2m 8s</span>
          </ConversationDivider>
          <ConversationDivider spacing={spacing} labelPosition="center">
            <span style={DIVIDER_LABEL_STYLE}>上下文已压缩</span>
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
      expect(lines[0][0].getBoundingClientRect().left).toBe(
        lines[1][0].getBoundingClientRect().left,
      );
      expect(lines[0][0].getBoundingClientRect().right).toBe(
        lines[1][1].getBoundingClientRect().right,
      );
      for (const divider of dividers) {
        expect(getComputedStyle(divider).paddingTop).toBe(`${spacing}px`);
        expect(getComputedStyle(divider).paddingBottom).toBe(`${spacing}px`);
      }
      const aboveLabel = dividers[0].querySelector("span");
      const centerLabel = dividers[1].querySelector("span");
      if (!aboveLabel || !centerLabel) throw new Error("缺少分割线标签");
      expect(
        lines[0][0].getBoundingClientRect().top - aboveLabel.getBoundingClientRect().bottom,
      ).toBe(spacing);
      expect(
        dividers[0].getBoundingClientRect().bottom - lines[0][0].getBoundingClientRect().bottom,
      ).toBe(spacing);
      expect(dividers[0].getBoundingClientRect().height).toBe(25 + spacing * 3);
      expect(dividers[1].getBoundingClientRect().height).toBe(
        centerLabel.getBoundingClientRect().height + spacing * 2,
      );
      for (const group of lines)
        for (const line of group) {
          expect(line.getBoundingClientRect().height).toBe(1);
          if (!line.parentElement) throw new Error("缺少横线容器");
          expect(line.parentElement.getBoundingClientRect().height).toBe(1);
        }
    } finally {
      root.unmount();
      host.remove();
    }
  },
);

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

test("不逐帧过渡布局时仍淡入淡出，快速重开不卸载正文", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (expanded: boolean) =>
    root.render(
      <DisclosureContent expanded={expanded} animateLayout={false} testID="atomic-disclosure">
        {() => <div style={CONTENT_STYLE}>过程正文</div>}
      </DisclosureContent>,
    );
  try {
    render(false);
    await nextFrame();
    render(true);
    await expect.poll(() => host.textContent).toBe("过程正文");
    const viewport = host.querySelector<HTMLElement>('[data-testid="atomic-disclosure"]');
    if (!viewport) throw new Error("缺少过程视口");
    const opacities: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      await nextFrame();
      opacities.push(Number(getComputedStyle(viewport).opacity));
    }
    expect(opacities.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
    await expect.poll(() => viewport.getBoundingClientRect().height).toBe(120);
    render(false);
    await nextFrame();
    render(true);
    for (let frame = 0; frame < 24; frame++) await nextFrame();
    expect(host.textContent).toBe("过程正文");
    expect(viewport.getBoundingClientRect().height).toBe(120);
    render(false);
    await expect.poll(() => host.textContent).toBe("");
  } finally {
    root.unmount();
    host.remove();
  }
});
