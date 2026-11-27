import { MOTION_DURATION, MOTION_EASING_CSS } from "@/styles/motion";

export type LiveEntrancePreset =
  | "row-reply"
  | "row-process"
  | "process-step"
  | "markdown-block"
  | "indicator";

export interface LiveEntranceItemLike {
  readonly id: string;
  readonly kind: string;
}

export interface LiveEntranceAnimationOptions {
  preset: LiveEntrancePreset;
  staggerIndex?: number;
}

export interface SmoothScrollChaseOptions {
  getScrollContainer: () => HTMLElement | null;
  applyScrollTop: (scroll: HTMLElement, nextTop: number) => void;
  onStep?: (scroll: HTMLElement) => void;
  onSettled?: (scroll: HTMLElement) => void;
  shouldContinue?: () => boolean;
  tauMs?: number;
  snapThresholdPx?: number;
  maxSmoothDistancePx?: number;
}

export interface SmoothScrollChase {
  chase: () => void;
  cancel: () => void;
  isActive: () => boolean;
}

interface LiveEntranceSpec {
  durationMs: number;
  offsetY: number;
  staggerMs: number;
  maxStaggerMs: number;
}

const LIVE_ENTRANCE_SPECS: Record<LiveEntrancePreset, LiveEntranceSpec> = {
  "row-reply": {
    durationMs: MOTION_DURATION.base + 40,
    offsetY: 8,
    staggerMs: 32,
    maxStaggerMs: 96,
  },
  "row-process": {
    durationMs: MOTION_DURATION.base,
    offsetY: 6,
    staggerMs: 28,
    maxStaggerMs: 84,
  },
  "process-step": {
    durationMs: 190,
    offsetY: 6,
    staggerMs: 24,
    maxStaggerMs: 72,
  },
  "markdown-block": {
    durationMs: 180,
    offsetY: 5,
    staggerMs: 20,
    maxStaggerMs: 60,
  },
  indicator: {
    durationMs: 160,
    offsetY: 4,
    staggerMs: 0,
    maxStaggerMs: 0,
  },
};

const DEFAULT_SMOOTH_CHASE_TAU_MS = 72;
const DEFAULT_SNAP_THRESHOLD_PX = 0.75;
const DEFAULT_MAX_SMOOTH_DISTANCE_PX = 900;
const MIN_CHASE_DT_MS = 1;
const MAX_CHASE_DT_MS = 50;
const MIN_CHASE_STEP_PX = 1;

export function isWebReducedMotionPreferred(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 仅挑出挂在列表尾部的新增实时条目：历史前插、虚拟窗口滚动恢复和展开旧回合均落在
 * 上一次末尾已知条目之前，因此绝不会误触发入场动画。
 */
export function findNewlyAppendedLiveItems<T extends LiveEntranceItemLike>(input: {
  items: readonly T[];
  seenIds: ReadonlySet<string>;
  eligible: (item: T) => boolean;
}): T[] {
  let lastSeenIndex = -1;
  for (let index = input.items.length - 1; index >= 0; index -= 1) {
    const item = input.items[index];
    if (item && input.seenIds.has(item.id)) {
      lastSeenIndex = index;
      break;
    }
  }
  const appended: T[] = [];
  for (let index = lastSeenIndex + 1; index < input.items.length; index += 1) {
    const item = input.items[index];
    if (item && !input.seenIds.has(item.id) && input.eligible(item)) {
      appended.push(item);
    }
  }
  return appended;
}

/**
 * 仅驱动 GPU 合成层属性（opacity + translate3d）的实时入场动画；不改变布局高度、
 * 不遗留 forwards 合成层上下文，减少动态效果开启时静默跳过。
 */
export function animateLiveElementEntrance(
  element: HTMLElement | null | undefined,
  options: LiveEntranceAnimationOptions,
): Animation | null {
  if (!element || typeof element.animate !== "function" || isWebReducedMotionPreferred()) {
    return null;
  }
  const spec = LIVE_ENTRANCE_SPECS[options.preset];
  const staggerIndex = Math.max(0, options.staggerIndex ?? 0);
  const delay = Math.min(spec.maxStaggerMs, staggerIndex * spec.staggerMs);
  const keyframes: Keyframe[] = [
    { opacity: 0, transform: `translate3d(0, ${spec.offsetY}px, 0)` },
    { opacity: 1, transform: "translate3d(0, 0, 0)" },
  ];
  return element.animate(keyframes, {
    duration: spec.durationMs,
    delay,
    easing: MOTION_EASING_CSS.standard,
    // 仅在错峰等待期间保持起始透明帧；结束后自动释放合成层，避免残余 transform 影响定位上下文。
    fill: delay > 0 ? "backwards" : "none",
  });
}

export function trackLiveAnimation(
  activeAnimations: Set<Animation>,
  animation: Animation | null,
): void {
  if (!animation) return;
  activeAnimations.add(animation);
  const cleanup = () => {
    activeAnimations.delete(animation);
  };
  if (typeof animation.addEventListener === "function") {
    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  }
}

/**
 * 临界阻尼指数平滑追尾控制器：连续高速追加命令或回复时无缝更新目标位置而不重启或卡顿，
 * 一旦用户介入滚动立刻取消。
 */
export function createSmoothScrollChase(options: SmoothScrollChaseOptions): SmoothScrollChase {
  const tauMs = options.tauMs ?? DEFAULT_SMOOTH_CHASE_TAU_MS;
  const snapThresholdPx = options.snapThresholdPx ?? DEFAULT_SNAP_THRESHOLD_PX;
  const maxSmoothDistancePx = options.maxSmoothDistancePx ?? DEFAULT_MAX_SMOOTH_DISTANCE_PX;

  let rafId: number | null = null;
  let lastFrameMs: number | null = null;

  const stop = () => {
    if (rafId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafId);
    }
    rafId = null;
    lastFrameMs = null;
  };

  const finishAtTarget = (scroll: HTMLElement, targetTop: number) => {
    options.applyScrollTop(scroll, targetTop);
    stop();
    options.onStep?.(scroll);
    options.onSettled?.(scroll);
  };

  const tick = (now: number) => {
    rafId = null;
    if (options.shouldContinue && !options.shouldContinue()) {
      stop();
      return;
    }
    const scroll = options.getScrollContainer();
    if (!scroll || scroll.clientHeight <= 0) {
      stop();
      return;
    }

    const targetTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const currentTop = scroll.scrollTop;
    const remaining = targetTop - currentTop;

    if (remaining <= snapThresholdPx) {
      if (remaining > 0.01) {
        options.applyScrollTop(scroll, targetTop);
      }
      stop();
      options.onStep?.(scroll);
      options.onSettled?.(scroll);
      return;
    }

    if (remaining > maxSmoothDistancePx) {
      finishAtTarget(scroll, targetTop);
      return;
    }

    const dt =
      lastFrameMs === null
        ? 16
        : Math.min(MAX_CHASE_DT_MS, Math.max(MIN_CHASE_DT_MS, now - lastFrameMs));
    lastFrameMs = now;

    const alpha = 1 - Math.exp(-dt / tauMs);
    const step = Math.max(MIN_CHASE_STEP_PX, remaining * alpha);
    const rawNextTop = currentTop + step;
    const nextTop = targetTop - rawNextTop <= snapThresholdPx ? targetTop : rawNextTop;

    const before = scroll.scrollTop;
    options.applyScrollTop(scroll, nextTop);
    options.onStep?.(scroll);
    const after = scroll.scrollTop;

    if (Math.abs(after - before) < 0.01 || targetTop - after <= snapThresholdPx) {
      stop();
      options.onSettled?.(scroll);
      return;
    }

    rafId = window.requestAnimationFrame(tick);
  };

  return {
    chase() {
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        return;
      }
      if (rafId !== null) {
        return;
      }
      lastFrameMs = null;
      rafId = window.requestAnimationFrame(tick);
    },
    cancel: stop,
    isActive: () => rafId !== null,
  };
}
