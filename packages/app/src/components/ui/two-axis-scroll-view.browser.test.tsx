import React from "react";
import { createRoot } from "react-dom/client";

import { expect, it } from "vitest";
import { TwoAxisScrollView } from "./two-axis-scroll-view";

const viewportStyle = { width: 320, maxHeight: 180 };

it("长命令输出的两轴共用固定高度视口，未滚到底也能横向滚动", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <TwoAxisScrollView style={viewportStyle}>
      <pre>{("很长的命令输出".repeat(40) + "\n").repeat(100)}</pre>
    </TwoAxisScrollView>,
  );
  try {
    await expect
      .poll(() => host.querySelector("[data-code-scroll-viewport]")?.scrollHeight ?? 0)
      .toBeGreaterThan(180);
    const viewport = host.querySelector("[data-code-scroll-viewport]");
    if (!(viewport instanceof HTMLElement)) throw new Error("命令滚动视口未挂载");
    expect(viewport.clientHeight).toBe(180);
    expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);
    expect(getComputedStyle(viewport).overflowX).toBe("auto");
    expect(getComputedStyle(viewport).overflowY).toBe("auto");
    viewport.scrollLeft = 120;
    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.scrollTop).toBe(0);
    viewport.scrollTop = 400;
    expect(viewport.scrollTop).toBe(400);
    expect(viewport.scrollLeft).toBe(120);
  } finally {
    root.unmount();
    host.remove();
  }
});
