import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getIsElectron, isWeb, isNative } from "@/constants/platform";
import { getIsAppActivelyVisible, getIsAppVisible } from "@/utils/app-visibility";
import { canShowLocalNotifications } from "@/utils/os-notifications";
import { readDesktopSystemIdleTimeMs } from "@/desktop/electron/idle";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import {
  type ClientActivityTracker,
  createClientActivityTracker,
  DESKTOP_IDLE_POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
} from "./client-activity-tracker";

interface ClientActivityOptions {
  client: DaemonClient;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
  onAppResumed?: (awayMs: number) => void;
}

/**
 * Handles client activity reporting:
 * - Heartbeat sending every 15 seconds
 * - App visibility tracking
 * - Records lastActivityAt only on real user activity (not on heartbeat)
 */
export function useClientActivity({
  client,
  focusedAgentId,
  focusedTerminalId,
  onAppResumed,
}: ClientActivityOptions): void {
  const onAppResumedRef = useRef(onAppResumed);
  onAppResumedRef.current = onAppResumed;

  const trackerRef = useRef<ClientActivityTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createClientActivityTracker({
      client,
      deviceType: isWeb ? "web" : "mobile",
      initialFocusedAgentId: focusedAgentId,
      initialFocusedTerminalId: focusedTerminalId,
      initialAppVisible: getIsAppVisible(),
      initialAppFocused: getIsAppActivelyVisible(),
      getCanShowLocalNotifications: canShowLocalNotifications,
      now: () => Date.now(),
      onAppResumed: (awayMs) => onAppResumedRef.current?.(awayMs),
    });
  }
  const tracker = trackerRef.current;

  // Track app visibility via AppState (native).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      tracker.notifyAppVisibility(nextState === "active");
      tracker.notifyAppFocus(nextState === "active");
      tracker.sendHeartbeat();
    });
    return () => subscription.remove();
  }, [tracker]);

  // Track user activity and visibility on web.
  useEffect(() => {
    if (isNative) return;
    if (typeof document === "undefined") return;

    const handleUserActivity = () => {
      tracker.recordUserActivity();
      tracker.maybeSendImmediateHeartbeat();
    };

    const syncWebPresence = (): boolean => {
      const visibilityChanged = tracker.notifyAppVisibility(getIsAppVisible());
      const focusChanged = tracker.notifyAppFocus(getIsAppActivelyVisible());
      if (visibilityChanged.changed || focusChanged.changed) {
        // 失焦/恢复焦点必须立即同步，不能被用户活动节流窗口延迟，否则服务端
        // 可能在这段时间内错误地抑制完成通知。
        tracker.sendHeartbeat();
        return true;
      }
      return false;
    };

    const handleVisibilityChange = () => {
      syncWebPresence();
    };
    const handleWindowFocus = () => {
      tracker.recordUserActivity();
      if (!syncWebPresence()) {
        tracker.maybeSendImmediateHeartbeat();
      }
    };
    const handleWindowBlur = () => {
      syncWebPresence();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("pointerdown", handleUserActivity, { passive: true });
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("wheel", handleUserActivity, { passive: true });
    window.addEventListener("touchstart", handleUserActivity, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("pointerdown", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("wheel", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
    };
  }, [tracker]);

  // Track OS-wide activity in Electron so backgrounded desktop windows still report presence.
  useEffect(() => {
    if (!getIsElectron()) return;

    let disposed = false;
    const pollSystemIdleTime = async () => {
      const systemIdleMs = await readDesktopSystemIdleTimeMs(invokeDesktopCommand);
      if (disposed) return;
      tracker.notifySystemIdleMs(systemIdleMs);
    };

    const interval = setInterval(() => {
      void pollSystemIdleTime();
    }, DESKTOP_IDLE_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [tracker]);

  // Send heartbeat on focused agent change.
  useEffect(() => {
    tracker.setFocusedAgentId(focusedAgentId);
  }, [focusedAgentId, tracker]);

  // Send heartbeat on focused terminal change.
  useEffect(() => {
    tracker.setFocusedTerminalId(focusedTerminalId);
  }, [focusedTerminalId, tracker]);

  // Periodic heartbeat gated by connection status.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) clearInterval(intervalId);
      tracker.sendHeartbeat();
      intervalId = setInterval(() => tracker.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const unsubscribe = client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") {
        start();
      } else {
        stop();
      }
    });

    return () => {
      unsubscribe();
      stop();
    };
  }, [client, tracker]);
}
