/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceHoverCardVisibility } from "./use-workspace-hover-card-visibility";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("打开相邻行预览立即撤销上一行，不等待离开宽限时间", () => {
  const first = renderHook(useWorkspaceHoverCardVisibility);
  const second = renderHook(useWorkspaceHoverCardVisibility);
  act(() => first.result.current.openCard());
  expect(first.result.current.open).toBe(true);
  act(() => second.result.current.openCard());
  expect([first.result.current.open, second.result.current.open]).toEqual([false, true]);
});

it("旧预览的迟到关闭动作不能关闭已经接替的新预览", () => {
  const first = renderHook(useWorkspaceHoverCardVisibility);
  const second = renderHook(useWorkspaceHoverCardVisibility);
  act(() => first.result.current.openCard());
  act(() => second.result.current.openCard());
  act(() => first.result.current.closeCard());
  expect([first.result.current.open, second.result.current.open]).toEqual([false, true]);
  act(() => second.result.current.closeCard());
  expect([first.result.current.open, second.result.current.open]).toEqual([false, false]);
});

it("卸载旧行不影响当前预览，卸载当前行释放显示槽", () => {
  const first = renderHook(useWorkspaceHoverCardVisibility);
  const second = renderHook(useWorkspaceHoverCardVisibility);
  act(() => first.result.current.openCard());
  act(() => second.result.current.openCard());
  first.unmount();
  expect(second.result.current.open).toBe(true);
  second.unmount();
  const next = renderHook(useWorkspaceHoverCardVisibility);
  expect(next.result.current.open).toBe(false);
  act(() => next.result.current.openCard());
  expect(next.result.current.open).toBe(true);
});

it("快速往返多行时始终只有最后一行拥有预览", () => {
  const rows = [
    renderHook(useWorkspaceHoverCardVisibility),
    renderHook(useWorkspaceHoverCardVisibility),
    renderHook(useWorkspaceHoverCardVisibility),
  ];
  for (const index of [0, 1, 2, 1, 0, 2]) {
    act(() => rows[index].result.current.openCard());
    expect(rows.map((row) => row.result.current.open)).toEqual(
      [0, 1, 2].map((value) => value === index),
    );
  }
});

it("跨间隙进入卡片会取消关闭，真正离开则在原有宽限期后关闭", () => {
  vi.useFakeTimers();
  const row = renderHook(() => useWorkspaceHoverCardVisibility());
  act(() => row.result.current.openCard());
  act(() => row.result.current.scheduleClose());
  act(() => vi.advanceTimersByTime(60));
  act(() => row.result.current.clearGraceTimer());
  act(() => vi.advanceTimersByTime(200));
  expect(row.result.current.open).toBe(true);
  act(() => row.result.current.scheduleClose());
  act(() => vi.advanceTimersByTime(99));
  expect(row.result.current.open).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(row.result.current.open).toBe(false);
});

it("旧行有关闭计时器时快速往返，也不会关闭当前行", () => {
  vi.useFakeTimers();
  const first = renderHook(() => useWorkspaceHoverCardVisibility());
  const second = renderHook(() => useWorkspaceHoverCardVisibility());
  act(() => first.result.current.openCard());
  act(() => first.result.current.scheduleClose());
  act(() => second.result.current.openCard());
  act(() => first.result.current.openCard());
  act(() => vi.advanceTimersByTime(200));
  expect([first.result.current.open, second.result.current.open]).toEqual([true, false]);
});

it("开始拖动立即关闭预览，拖动结束不会自行重开", () => {
  const row = renderHook(({ dragging }) => useWorkspaceHoverCardVisibility(dragging), {
    initialProps: { dragging: false },
  });
  act(() => row.result.current.openCard());
  row.rerender({ dragging: true });
  expect(row.result.current.open).toBe(false);
  act(() => row.result.current.openCard());
  expect(row.result.current.open).toBe(false);
  row.rerender({ dragging: false });
  expect(row.result.current.open).toBe(false);
});
