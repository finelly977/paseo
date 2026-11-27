// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animateLiveElementEntrance,
  createSmoothScrollChase,
  findNewlyAppendedLiveItems,
} from "./live-entrance.web";

function mockMatchMedia(reduced: boolean) {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return () => {
    window.matchMedia = original;
  };
}

describe("findNewlyAppendedLiveItems", () => {
  it("仅返回尾部新增且符合条件的实时条目，忽略历史前插与旧回合展开", () => {
    const seen = new Set(["u-1", "a-1", "tc-1"]);
    const items = [
      { id: "u-0", kind: "user_message" },
      { id: "a-0", kind: "assistant_message" },
      { id: "u-1", kind: "user_message" },
      { id: "expanded-old-tc", kind: "tool_call" },
      { id: "a-1", kind: "assistant_message" },
      { id: "tc-1", kind: "tool_call" },
      { id: "u-2", kind: "user_message" },
      { id: "tc-2", kind: "tool_call" },
      { id: "a-2", kind: "assistant_message" },
    ];

    const appended = findNewlyAppendedLiveItems({
      items,
      seenIds: seen,
      eligible: (item) => item.kind !== "user_message",
    });

    expect(appended.map((item) => item.id)).toEqual(["tc-2", "a-2"]);
  });

  it("在已有全部条目都已见过时不返回任何条目", () => {
    const seen = new Set(["u-1", "a-1"]);
    const appended = findNewlyAppendedLiveItems({
      items: [
        { id: "u-1", kind: "user_message" },
        { id: "a-1", kind: "assistant_message" },
      ],
      seenIds: seen,
      eligible: () => true,
    });

    expect(appended).toEqual([]);
  });
});

describe("animateLiveElementEntrance", () => {
  let restoreMatchMedia: (() => void) | null = null;

  afterEach(() => {
    restoreMatchMedia?.();
    restoreMatchMedia = null;
  });

  it("使用纯合成层关键帧并按上限错峰，且不遗留 forwards 状态", () => {
    restoreMatchMedia = mockMatchMedia(false);
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    const element = { animate } as unknown as HTMLElement;

    animateLiveElementEntrance(element, { preset: "row-reply", staggerIndex: 0 });
    expect(animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translate3d(0, 8px, 0)" },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      expect.objectContaining({
        duration: 240,
        delay: 0,
        fill: "none",
      }),
    );

    animateLiveElementEntrance(element, { preset: "process-step", staggerIndex: 10 });
    expect(animate).toHaveBeenLastCalledWith(
      [
        { opacity: 0, transform: "translate3d(0, 6px, 0)" },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ],
      expect.objectContaining({
        duration: 190,
        delay: 72,
        fill: "backwards",
      }),
    );
  });

  it("开启系统减少动态效果时跳过入场动画", () => {
    restoreMatchMedia = mockMatchMedia(true);
    const animate = vi.fn();
    const element = { animate } as unknown as HTMLElement;

    const result = animateLiveElementEntrance(element, { preset: "row-process" });
    expect(result).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("createSmoothScrollChase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("在连续高速增高时平滑追尾到底部并在到位后停止 RAF", () => {
    let now = 0;
    const queue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      queue.delete(id);
    });

    const flushNextFrame = () => {
      const first = queue.entries().next();
      if (first.done) return false;
      const [id, callback] = first.value;
      queue.delete(id);
      now += 16;
      callback(now);
      return true;
    };

    const scroll = {
      scrollTop: 100,
      scrollHeight: 580,
      clientHeight: 400,
    } as unknown as HTMLElement;

    const onStep = vi.fn();
    const onSettled = vi.fn();
    const chase = createSmoothScrollChase({
      getScrollContainer: () => scroll,
      applyScrollTop: (node, nextTop) => {
        node.scrollTop = nextTop;
      },
      onStep,
      onSettled,
    });

    chase.chase();
    expect(chase.isActive()).toBe(true);

    // 推进两帧并在途中继续增高（模拟高速命令连发）。
    expect(flushNextFrame()).toBe(true);
    expect(scroll.scrollTop).toBeGreaterThan(100);
    expect(scroll.scrollTop).toBeLessThan(180);

    (scroll as unknown as { scrollHeight: number }).scrollHeight = 640;
    chase.chase();

    let steps = 0;
    while (flushNextFrame() && steps < 60) {
      steps += 1;
    }

    expect(scroll.scrollTop).toBe(240);
    expect(chase.isActive()).toBe(false);
    expect(onStep).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("用户介入取消后立即停止追尾，超大跳跃直接到位", () => {
    const queue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      queue.delete(id);
    });

    const scroll = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 400,
    } as unknown as HTMLElement;

    const chase = createSmoothScrollChase({
      getScrollContainer: () => scroll,
      applyScrollTop: (node, nextTop) => {
        node.scrollTop = nextTop;
      },
      maxSmoothDistancePx: 900,
    });

    chase.chase();
    chase.cancel();
    expect(chase.isActive()).toBe(false);
    expect(queue.size).toBe(0);

    // 超过平滑阈值时直接到位，不拖慢阅读。
    chase.chase();
    const callback = queue.values().next().value;
    queue.clear();
    callback?.(16);
    expect(scroll.scrollTop).toBe(1600);
    expect(chase.isActive()).toBe(false);
  });
});
