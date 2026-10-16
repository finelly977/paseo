import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentToggleAnchor } from "./content-toggle-anchor";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(inverted: boolean) {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  let offset = 200;
  let top = 120;
  const detach = vi.fn();
  const active = vi.fn();
  const anchor = createContentToggleAnchor({
    inverted,
    getOffset: () => offset,
    detach,
    setActive: active,
    setOffset: (next) => {
      top += inverted ? next - offset : offset - next;
      offset = next;
    },
  });
  return {
    anchor,
    active,
    detach,
    getOffset: () => offset,
    getTop: () => top,
    measure: (callback: (top: number | null) => void) => callback(top),
    shift: (delta: number) => {
      top += delta;
    },
  };
}

describe("展开过程的阅读位置", () => {
  it.each([true, false])("倒置=%s 时按入口位置校正，而不是跳到回复或底部", (inverted) => {
    const test = setup(inverted);
    const change = vi.fn(() => test.shift(inverted ? -360 : 360));
    test.anchor.preserve({ itemId: "process", measure: test.measure, applyChange: change });
    vi.advanceTimersByTime(100);
    expect(test.getTop()).toBe(120);
    expect(test.getOffset()).toBe(560);
    expect(change).toHaveBeenCalledTimes(1);
    expect(test.detach).toHaveBeenCalledTimes(1);
    expect(test.active).toHaveBeenLastCalledWith(false);
  });
  it("用户开始滚动时立即停止校正", () => {
    const test = setup(true);
    test.anchor.preserve({
      itemId: "process",
      measure: test.measure,
      applyChange: () => test.shift(-360),
    });
    test.anchor.cancel();
    vi.advanceTimersByTime(700);
    expect(test.getOffset()).toBe(200);
  });
  it("切走或快速再次点击时不应用迟到的原生测量", () => {
    const test = setup(true);
    let late: ((top: number | null) => void) | null = null;
    const change = vi.fn();
    test.anchor.preserve({
      itemId: "process",
      measure: (callback) => {
        late = callback;
      },
      applyChange: change,
    });
    test.anchor.cancel();
    if (!late) throw new Error("缺少待验证的测量回调");
    (late as (top: number | null) => void)(120);
    expect(change).not.toHaveBeenCalled();
  });
  it("原生节点卸载且不再回调时释放临时锚定", () => {
    const test = setup(true);
    let measurements = 0;
    test.anchor.preserve({
      itemId: "process",
      measure: (callback) => {
        measurements += 1;
        if (measurements === 1) callback(120);
      },
      applyChange: () => undefined,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.advanceTimersByTime(8100);
    expect(test.active).toHaveBeenLastCalledWith(false);
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
  it("虚拟列表临时移除入口后，重新挂载仍恢复同一屏幕位置", () => {
    const test = setup(true);
    let measurements = 0;
    test.anchor.preserve({
      itemId: "process",
      measure: (callback) => {
        measurements += 1;
        callback(measurements > 1 && measurements < 6 ? null : test.getTop());
      },
      applyChange: () => test.shift(-500),
    });
    vi.advanceTimersByTime(200);
    expect(test.getTop()).toBe(120);
    expect(test.getOffset()).toBe(700);
    expect(test.active).toHaveBeenLastCalledWith(false);
  });
  it("部分原生测量不回调也不阻断下一帧恢复", () => {
    const test = setup(true);
    let measurements = 0;
    test.anchor.preserve({
      itemId: "process",
      measure: (callback) => {
        measurements += 1;
        if (measurements === 2 || measurements === 3) return;
        callback(test.getTop());
      },
      applyChange: () => test.shift(-500),
    });
    vi.advanceTimersByTime(200);
    expect(test.getTop()).toBe(120);
    expect(test.getOffset()).toBe(700);
    expect(test.active).toHaveBeenLastCalledWith(false);
  });
});
