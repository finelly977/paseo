import React from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { GitChangeCountBadge } from "./change-count-badge";
import { applyRootUiFont } from "@/appearance/apply-root-font.web";

test.each(["Arial", "Segoe UI", "Microsoft YaHei"])(
  "%s 字体下数量标记保持正圆或多位胶囊，数字居中",
  async (font) => {
    const host = document.createElement("div");
    Object.assign(host.style, {
      display: "flex",
      width: "180px",
      alignItems: "center",
      gap: "4px",
    });
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      applyRootUiFont(font, 16);
      root.render(
        <>
          {[0, 9, 19, 99, 100, 1999].map((count) => (
            <GitChangeCountBadge key={count} count={count} label="更改" />
          ))}
        </>,
      );
      await expect
        .poll(() => host.querySelectorAll('[data-testid="git-change-count"]').length)
        .toBe(6);
      for (const badge of host.querySelectorAll<HTMLElement>('[data-testid="git-change-count"]')) {
        const text = badge.firstElementChild;
        if (!(text instanceof HTMLElement)) throw new Error("缺少数量文字");
        const count = Number(text.textContent);
        const bounds = badge.getBoundingClientRect();
        const label = text.getBoundingClientRect();
        expect(bounds.height).toBe(16);
        if (count < 100) expect(bounds.width).toBe(bounds.height);
        else expect(bounds.width).toBeGreaterThanOrEqual(bounds.height);
        expect(
          Math.abs(label.x + label.width / 2 - bounds.x - bounds.width / 2),
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(label.y + label.height / 2 - bounds.y - bounds.height / 2),
        ).toBeLessThanOrEqual(0.5);
        expect(getComputedStyle(text).fontSize).toBe("10px");
      }
    } finally {
      root.unmount();
      host.remove();
      document.getElementById("paseo-ui-font")?.remove();
      for (const property of [
        "--paseo-ui-font",
        "--paseo-ui-font-size",
        "--paseo-sidebar-font-size",
      ])
        document.documentElement.style.removeProperty(property);
    }
  },
);
