import { describe, expect, test } from "vitest";

import { hasActiveWebOverlay, registerActiveWebOverlay } from "./overlay-root";

describe("网页浮层活动状态", () => {
  test("在最后一个浮层释放前保持活动，并允许清理函数重复调用", () => {
    const unregisterFirst = registerActiveWebOverlay();
    const unregisterSecond = registerActiveWebOverlay();

    expect(hasActiveWebOverlay()).toBe(true);

    unregisterFirst();
    unregisterFirst();
    expect(hasActiveWebOverlay()).toBe(true);

    unregisterSecond();
    expect(hasActiveWebOverlay()).toBe(false);
  });
});
