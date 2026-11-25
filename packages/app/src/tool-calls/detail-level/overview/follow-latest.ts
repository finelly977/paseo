import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { isWeb } from "@/constants/platform";

const FOLLOW_LATEST_BOTTOM_THRESHOLD_PX = 16;
const USER_UPWARD_SCROLL_EPSILON_PX = 2;
const PROGRAMMATIC_SMOOTH_SCROLL_WINDOW_MS = 450;
const EDGE_FADE_THRESHOLD_PX = 2;

export type ScrollEdgeFade = "none" | "top" | "bottom" | "both";

export function resolveScrollEdgeFade(input: {
  offsetY: number;
  viewportHeight: number;
  contentHeight: number;
}): ScrollEdgeFade {
  if (
    input.viewportHeight <= 0 ||
    input.contentHeight <= input.viewportHeight + EDGE_FADE_THRESHOLD_PX
  ) {
    return "none";
  }
  const hasTop = input.offsetY > EDGE_FADE_THRESHOLD_PX;
  const hasBottom =
    input.contentHeight - input.viewportHeight - input.offsetY > EDGE_FADE_THRESHOLD_PX;
  if (hasTop && hasBottom) return "both";
  if (hasTop) return "top";
  if (hasBottom) return "bottom";
  return "none";
}

export function buildScrollEdgeMaskImage(edgeFade: ScrollEdgeFade): string {
  switch (edgeFade) {
    case "top":
      return "linear-gradient(to bottom, transparent 0px, rgba(0, 0, 0, 0.35) 14px, rgba(0, 0, 0, 0.85) 28px, black 40px, black 100%)";
    case "bottom":
      return "linear-gradient(to bottom, black 0px, black calc(100% - 40px), rgba(0, 0, 0, 0.85) calc(100% - 28px), rgba(0, 0, 0, 0.35) calc(100% - 14px), transparent 100%)";
    case "both":
      return "linear-gradient(to bottom, transparent 0px, rgba(0, 0, 0, 0.35) 14px, rgba(0, 0, 0, 0.85) 28px, black 40px, black calc(100% - 40px), rgba(0, 0, 0, 0.85) calc(100% - 28px), rgba(0, 0, 0, 0.35) calc(100% - 14px), transparent 100%)";
    case "none":
      return "none";
  }
}

function prefersReducedMotion(): boolean {
  if (!isWeb || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface FollowLatestScrollInput {
  open: boolean;
  itemCount: number;
  latestItemId: string;
  scrollToEnd: (animated: boolean) => void;
  onEdgeFadeChange?: (edgeFade: ScrollEdgeFade) => void;
}

/**
 * 仅在首次打开或新增过程步骤且读者仍接近列表底部时追尾滚动；
 * 展开子条目详情造成的高度变化不触发追尾，用户向上滚动立即解除跟随。
 */
export function useFollowLatestScroll({
  open,
  itemCount,
  latestItemId,
  scrollToEnd,
  onEdgeFadeChange,
}: FollowLatestScrollInput) {
  const followLatestRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const programmaticUntilRef = useRef(0);
  const wasOpenRef = useRef(false);
  const previousItemCountRef = useRef(itemCount);
  const previousLatestItemIdRef = useRef(latestItemId);
  const edgeFadeRef = useRef<ScrollEdgeFade>("none");

  const updateEdgeFade = useCallback(
    (offsetY: number, viewportHeight: number, contentHeight: number) => {
      const next = resolveScrollEdgeFade({ offsetY, viewportHeight, contentHeight });
      if (next === edgeFadeRef.current) {
        return;
      }
      edgeFadeRef.current = next;
      onEdgeFadeChange?.(next);
    },
    [onEdgeFadeChange],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
      const offsetY = contentOffset.y;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - offsetY;
      const movedUp = offsetY < lastScrollTopRef.current - USER_UPWARD_SCROLL_EPSILON_PX;
      lastScrollTopRef.current = offsetY;
      updateEdgeFade(offsetY, layoutMeasurement.height, contentSize.height);

      if (movedUp) {
        followLatestRef.current = false;
        programmaticUntilRef.current = 0;
        return;
      }
      if (distanceFromBottom <= FOLLOW_LATEST_BOTTOM_THRESHOLD_PX) {
        followLatestRef.current = true;
        programmaticUntilRef.current = 0;
        return;
      }
      if (Date.now() > programmaticUntilRef.current) {
        followLatestRef.current = false;
      }
    },
    [updateEdgeFade],
  );

  useEffect(() => {
    if (!open) {
      followLatestRef.current = true;
      wasOpenRef.current = false;
      programmaticUntilRef.current = 0;
      lastScrollTopRef.current = 0;
      previousItemCountRef.current = itemCount;
      previousLatestItemIdRef.current = latestItemId;
      if (edgeFadeRef.current !== "none") {
        edgeFadeRef.current = "none";
        onEdgeFadeChange?.("none");
      }
      return;
    }

    const justOpened = !wasOpenRef.current;
    const itemAppended =
      itemCount > previousItemCountRef.current ||
      (itemCount === previousItemCountRef.current &&
        latestItemId !== previousLatestItemIdRef.current);
    wasOpenRef.current = true;
    previousItemCountRef.current = itemCount;
    previousLatestItemIdRef.current = latestItemId;

    if ((!justOpened && !itemAppended) || !followLatestRef.current) {
      return;
    }

    const animated = !justOpened && !prefersReducedMotion();
    if (animated) {
      programmaticUntilRef.current = Date.now() + PROGRAMMATIC_SMOOTH_SCROLL_WINDOW_MS;
    } else {
      programmaticUntilRef.current = 0;
    }

    const frame = requestAnimationFrame(() => {
      scrollToEnd(animated);
    });
    return () => cancelAnimationFrame(frame);
  }, [itemCount, latestItemId, onEdgeFadeChange, open, scrollToEnd]);

  return { handleScroll, syncEdgeFade: updateEdgeFade };
}
