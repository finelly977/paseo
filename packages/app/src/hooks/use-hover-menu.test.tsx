// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHoverMenuEnabled, useHoverMenu } from "./use-hover-menu";

vi.mock("@/constants/platform", () => ({ isWeb: true }));
const triggerRef = {
  current: { getBoundingClientRect: () => ({ left: 0, right: 100, top: 20, bottom: 60 }) },
} as never;
const contentRef = {
  current: { getBoundingClientRect: () => ({ left: 120, right: 260, top: 20, bottom: 140 }) },
} as never;

function point(x: number, y: number, pointerType = "mouse"): void {
  const event = new MouseEvent("pointermove", { clientX: x, clientY: y, buttons: 0 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => document.dispatchEvent(event));
}
function elapsed(ms: number): void {
  act(() => vi.advanceTimersByTime(ms));
}
function mount(enabled = true) {
  vi.useFakeTimers();
  return renderHook(() => {
    const [open, setOpen] = useState(false);
    useHoverMenu({ enabled, open, onOpenChange: setOpen, triggerRef, contentRef });
    return { open, setOpen };
  });
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("子菜单悬停", () => {
  it("短暂路过不打开，停留后打开，跨间隙进入选项不关闭", () => {
    const { result } = mount();
    point(40, 30);
    elapsed(80);
    expect(result.current.open).toBe(false);
    elapsed(20);
    expect(result.current.open).toBe(true);
    point(110, 45);
    elapsed(300);
    expect(result.current.open).toBe(true);
    point(160, 100);
    elapsed(300);
    expect(result.current.open).toBe(true);
    point(400, 400);
    elapsed(159);
    expect(result.current.open).toBe(true);
    elapsed(1);
    expect(result.current.open).toBe(false);
  });
  it("主动关闭后不会在原位置马上重开，离开再回来可以打开", () => {
    const { result } = mount();
    point(40, 30);
    elapsed(100);
    act(() => result.current.setOpen(false));
    point(40, 30);
    elapsed(200);
    expect(result.current.open).toBe(false);
    point(400, 400);
    point(40, 30);
    elapsed(100);
    expect(result.current.open).toBe(true);
  });
  it("触摸事件和禁用的悬停模式不打开菜单", () => {
    const first = mount();
    point(40, 30, "touch");
    elapsed(200);
    expect(first.result.current.open).toBe(false);
    first.unmount();
    const second = mount(false);
    point(40, 30);
    elapsed(200);
    expect(second.result.current.open).toBe(false);
    expect(resolveHoverMenuEnabled(true, false, false)).toBe(true);
    expect(resolveHoverMenuEnabled(true, true, false)).toBe(false);
    expect(resolveHoverMenuEnabled(true, false, true)).toBe(false);
  });
  it("卸载时取消尚未触发的打开动作", () => {
    const hook = mount();
    point(40, 30);
    hook.unmount();
    elapsed(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});
