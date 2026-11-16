import React from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { ThinkingSliderView } from "./thinking-slider.web";

const OPTIONS = ["Low", "Medium", "High", "Extra high", "Max", "Ultra"].map((label) => ({
  id: label,
  label,
}));
function noAction() {}

test.each([0, 4, 5])("第 %i 档滑块和粒子均留在卡片内容范围内", async (index) => {
  const host = document.createElement("div");
  host.style.cssText = "width:260px;padding:8px";
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <ThinkingSliderView
        options={OPTIONS}
        selectedIndex={index}
        maxed={index === 5}
        disabled={false}
        onSelect={noAction}
        blue="#0169cc"
        dot="#888888"
        focus="#0169cc"
        spark="#b59aff"
      />,
    );
    await expect
      .poll(() => host.querySelector('[data-testid="thinking-slider-thumb"]'))
      .not.toBeNull();
    const wrapper = host.querySelector<HTMLElement>('[data-testid="thinking-slider"]');
    const thumb = host.querySelector<HTMLElement>('[data-testid="thinking-slider-thumb"]');
    const paint = host.querySelector<HTMLElement>('[data-testid="thinking-slider-paint"]');
    if (!wrapper || !thumb || !paint) throw new Error("滑轨未挂载");
    const bounds = wrapper.getBoundingClientRect();
    const knob = thumb.getBoundingClientRect();
    expect(knob.top).toBeGreaterThanOrEqual(bounds.top);
    expect(knob.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(knob.left).toBeGreaterThanOrEqual(bounds.left);
    expect(knob.right).toBeLessThanOrEqual(bounds.right);
    expect(getComputedStyle(thumb).backgroundColor).toBe("rgb(181, 154, 255)");
    expect(getComputedStyle(paint).overflow).toBe("hidden");
    expect(host.scrollWidth).toBe(host.clientWidth);
  } finally {
    root.unmount();
    host.remove();
  }
});
