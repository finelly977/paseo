import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { isNative } from "@/constants/platform";

/** 读取系统减少动态效果设置（原生与非浏览器环境的跨平台实现）。 */
export function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (!isNative) {
      return;
    }
    let cancelled = false;
    let preferenceUpdated = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      preferenceUpdated = true;
      setReduced(enabled);
    });
    async function readInitialPreference() {
      try {
        const enabled = await AccessibilityInfo.isReduceMotionEnabled();
        if (!cancelled && !preferenceUpdated) setReduced(enabled);
      } catch (error) {
        console.error("无法读取系统减少动态效果设置", error);
      }
    }
    void readInitialPreference();
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
