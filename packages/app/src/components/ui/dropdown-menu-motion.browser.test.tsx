import React from "react";
import { createRoot } from "react-dom/client";
import type { ViewStyle } from "react-native";
import { page } from "vitest/browser";
import { expect, it } from "vitest";
import { FloatingSurface } from "./floating";
import { dropdownMenuEntering } from "./dropdown-menu-motion";
import { MOTION_DURATION } from "@/styles/motion";

it("菜单先在屏幕外测量，入场结束后才定位也不会被动画清理移回旧位置", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let selected = false;
  const entered = new Promise<void>((resolve) => {
    host.addEventListener("animationend", () => resolve(), { once: true });
  });
  host.addEventListener("click", () => (selected = true), { once: true });
  const renderSurface = (frameStyle: ViewStyle) => {
    root.render(
      <FloatingSurface
        testID="delayed-model-menu"
        frameStyle={frameStyle}
        entering={dropdownMenuEntering}
      >
        <button type="button">选择模型</button>
      </FloatingSurface>,
    );
  };

  try {
    renderSurface({ position: "absolute", left: -9999, top: -9999, width: 300, height: 120 });
    await entered;
    renderSurface({ position: "absolute", left: 80, top: 100, width: 300, height: 160 });
    const getRect = () => {
      const surface = host.querySelector('[data-testid="delayed-model-menu"]');
      if (!(surface instanceof HTMLElement)) throw new Error("模型菜单未挂载");
      const { x, y, width, height } = surface.getBoundingClientRect();
      return { x, y, width, height };
    };
    await expect.poll(getRect).toEqual({ x: 80, y: 100, width: 300, height: 160 });

    // 等待真实 Reanimated 自定义动画的延迟清理期限，不替换动画、计时器或 DOM。
    await new Promise((resolve) => setTimeout(resolve, MOTION_DURATION.fast * 5 + 100));
    expect(getRect()).toEqual({ x: 80, y: 100, width: 300, height: 160 });
    await page.getByRole("button", { name: "选择模型" }).click();
    expect(selected).toBe(true);
  } finally {
    root.unmount();
    host.remove();
  }
});
