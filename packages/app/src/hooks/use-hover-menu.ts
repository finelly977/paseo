import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import { useHoverSafeZone } from "./use-hover-safe-zone";

interface HoverMenuInput {
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<View | null>;
  contentRef: RefObject<View | null>;
}

// 菜单与触发行分处浮层时，沿用安全区桥接；短延迟过滤路过，移到选项时不闪退。
export function useHoverMenu({
  enabled,
  open,
  onOpenChange,
  triggerRef,
  contentRef,
}: HoverMenuInput): void {
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressed = useRef(false);
  const closedByHover = useRef(false);
  const previousOpen = useRef(open);
  const clearOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  useEffect(() => {
    if (previousOpen.current && !open) {
      suppressed.current = !closedByHover.current;
      closedByHover.current = false;
    }
    previousOpen.current = open;
  }, [open]);
  const enter = useCallback(() => {
    clearClose();
    if (open || suppressed.current || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      onOpenChange(true);
    }, 100);
  }, [clearClose, open, onOpenChange]);
  const leave = useCallback(() => {
    suppressed.current = false;
    clearOpen();
    if (!open || closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      closedByHover.current = true;
      onOpenChange(false);
    }, 160);
  }, [clearOpen, open, onOpenChange]);
  useHoverSafeZone({
    enabled,
    triggerRef,
    contentRef,
    onEnterSafeZone: enter,
    onLeaveSafeZone: leave,
    hoverOnly: true,
  });
  useEffect(
    () => () => {
      clearOpen();
      clearClose();
    },
    [enabled, clearOpen, clearClose],
  );
}

export function resolveHoverMenuEnabled(
  openOnHover: boolean | undefined,
  isCompact: boolean,
  disabled: boolean,
): boolean {
  return openOnHover === true && !isCompact && !disabled;
}
