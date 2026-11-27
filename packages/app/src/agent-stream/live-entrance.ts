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

export function isWebReducedMotionPreferred(): boolean {
  return true;
}

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

export function animateLiveElementEntrance(
  _element: HTMLElement | null | undefined,
  _options: LiveEntranceAnimationOptions,
): Animation | null {
  return null;
}

export function trackLiveAnimation(
  _activeAnimations: Set<Animation>,
  _animation: Animation | null,
): void {}

export function createSmoothScrollChase(_options: SmoothScrollChaseOptions): SmoothScrollChase {
  return {
    chase: () => {},
    cancel: () => {},
    isActive: () => false,
  };
}
