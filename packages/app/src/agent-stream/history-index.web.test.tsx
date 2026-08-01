/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import { ConversationHistoryIndex } from "./history-index.web";

const { matchMediaMock, theme } = vi.hoisted(() => {
  const hoistedMatchMediaMock = vi.fn((_query: string) => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const hoistedTheme = {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    iconSize: { sm: 14, md: 18, lg: 22 },
    borderWidth: { 1: 1 },
    borderRadius: { full: 999, md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500" },
    colors: {
      surface1: "#111",
      surface2: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
    },
  };
  return { matchMediaMock: hoistedMatchMediaMock, theme: hoistedTheme };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

interface MockResizeInstance {
  callback: ResizeObserverCallback;
  observesBand: boolean;
}

let resizeInstances: MockResizeInstance[] = [];

const EMPTY_VIEWPORT_REF = { current: null };

function entry(index: number): ConversationHistoryIndexEntry {
  return {
    id: `turn-${index}`,
    title: `Turn ${index}`,
    preview: `Preview ${index}`,
    sourceIndex: index,
  };
}

function mockRailMetrics(rail: HTMLElement, clientHeight: number, scrollHeight: number) {
  Object.defineProperty(rail, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(rail, "scrollHeight", { configurable: true, value: scrollHeight });
}

describe("ConversationHistoryIndex web rail", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMediaMock });
    resizeInstances = [];
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        callback: ResizeObserverCallback;
        observesBand = false;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          resizeInstances.push(this);
        }
        observe(target: Element) {
          // 组件观察的是 band（原生 div，无 RNW layout handler）；RNW 观察的是带 handler 的 View
          if (!("__reactLayoutHandler" in target)) {
            this.observesBand = true;
          }
        }
        unobserve() {}
        disconnect() {}
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    resizeInstances = [];
    vi.restoreAllMocks();
  });

  function triggerBandResize(height: number) {
    const instance = resizeInstances.find((candidate) => candidate.observesBand);
    act(() => {
      instance?.callback?.(
        [{ contentRect: { height } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
  }

  function renderIndex(entryCount: number, bandHeight: number): HTMLElement {
    const entries = Array.from({ length: entryCount }, (_, index) => entry(index));
    act(() => {
      root?.render(<ConversationHistoryIndex entries={entries} viewportRef={EMPTY_VIEWPORT_REF} />);
    });
    triggerBandResize(bandHeight);
    const rail = container?.querySelector('[role="navigation"]');
    if (!(rail instanceof HTMLElement)) {
      throw new Error("rail 未渲染");
    }
    mockRailMetrics(rail, 480, (entryCount - 1) * 8 + 12);
    // 轨道 DOM 尺寸就绪后重新触发测量，让“保持底部”的 effect 在真实尺寸下运行。
    triggerBandResize(bandHeight + 1);
    triggerBandResize(bandHeight);
    return rail;
  }

  function waveScales(rail: HTMLElement): number[] {
    const markers = rail.querySelectorAll('div[aria-hidden="true"]');
    return Array.from(markers, (marker) => {
      const match = (marker as HTMLElement).style.transform.match(/scaleX\(([\d.]+)\)/);
      return match ? Number(match[1]) : 0;
    });
  }

  it("索引超出轨道高度时默认显示最新（底部）", () => {
    const rail = renderIndex(200, 800);

    const maxScroll = 199 * 8 + 12 - 480;
    expect(maxScroll).toBeGreaterThan(0);
    expect(rail.scrollTop).toBe(maxScroll);
  });

  it("轨道需要滚动时悬停仍产生山峰动画", async () => {
    const rail = renderIndex(200, 800);
    // 修复后默认滚到底部，悬停波浪应跟随到最新刻度区域
    expect(rail.scrollTop).toBe(199 * 8 + 12 - 480);
    rail.getBoundingClientRect = () =>
      ({
        top: 160,
        bottom: 640,
        height: 480,
        left: 0,
        right: 32,
        width: 32,
        x: 0,
        y: 160,
      }) as DOMRect;

    act(() => {
      rail.dispatchEvent(new MouseEvent("mousemove", { clientY: 400, bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scales = waveScales(rail);
    expect(scales.length).toBe(200);
    // 指针分数 = (240 + 1124) / 1592 ≈ 0.857 → 第 171 个刻度最大
    expect(scales[171]).toBeCloseTo(2.75, 1);
    expect(scales[0]).toBe(1);
    expect(scales[30]).toBe(1);
  });

  it("轨道滚动到历史位置后悬停仍产生山峰动画", async () => {
    const rail = renderIndex(200, 800);
    rail.getBoundingClientRect = () =>
      ({
        top: 160,
        bottom: 640,
        height: 480,
        left: 0,
        right: 32,
        width: 32,
        x: 0,
        y: 160,
      }) as DOMRect;
    rail.scrollTop = 500;
    act(() => {
      rail.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    act(() => {
      rail.dispatchEvent(new MouseEvent("mousemove", { clientY: 400, bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scales = waveScales(rail);
    // 指针分数 = (240 + 500) / 1592 ≈ 0.465 → 第 92 个刻度最大
    expect(scales[92]).toBeCloseTo(2.75, 1);
    expect(scales[0]).toBe(1);
  });

  it("条目远超轨道高度时，悬停波浪仍只在可见区域内局部出现", async () => {
    const rail = renderIndex(1000, 800);
    // 内容高度 = 999*8 + 12 = 8004，默认滚到底部 scrollTop = 7524
    expect(rail.scrollTop).toBe(7524);
    rail.getBoundingClientRect = () =>
      ({
        top: 160,
        bottom: 640,
        height: 480,
        left: 0,
        right: 32,
        width: 32,
        x: 0,
        y: 160,
      }) as DOMRect;

    act(() => {
      rail.dispatchEvent(new MouseEvent("mousemove", { clientY: 400, bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scales = waveScales(rail);
    expect(scales.length).toBe(1000);
    // 指针内容坐标 = (240 + 7524) + 6 = 7770，第 970 个刻度中心 = 7766
    expect(scales[970]).toBeCloseTo(2.75, 1);
    // 波浪半径 = 480 * 0.14 ≈ 67px，约 8 个刻度：可见区域内远离指针处完全不动
    expect(scales[900]).toBe(1);
    expect(scales[0]).toBe(1);
  });
});
