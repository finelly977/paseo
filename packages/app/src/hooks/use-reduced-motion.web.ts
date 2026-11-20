import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function readReducedMotionSnapshot(): boolean {
  return getMediaQuery()?.matches ?? false;
}

function readServerReducedMotionSnapshot(): boolean {
  return false;
}

function subscribeReducedMotion(notify: () => void): () => void {
  const query = getMediaQuery();
  if (!query) {
    return () => {};
  }
  query.addEventListener("change", notify);
  return () => {
    query.removeEventListener("change", notify);
  };
}

/** 订阅网页/桌面环境系统的减少动态效果设置；缺少 matchMedia 的测试环境安全回退为 false。 */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotionSnapshot,
    readServerReducedMotionSnapshot,
  );
}
