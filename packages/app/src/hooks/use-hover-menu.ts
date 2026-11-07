import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import { useHoverSafeZone } from "./use-hover-safe-zone";
import { isWeb } from "@/constants/platform";

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
}: HoverMenuInput): () => void {
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressed = useRef(false);
  const closedByHover = useRef(false);
  const previousOpen = useRef(open);
  const openedByHover = useRef(false);
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
      openedByHover.current = false;
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
      openedByHover.current = true;
      onOpenChange(true);
    }, 100);
  }, [clearClose, open, onOpenChange]);
  const leave = useCallback(() => {
    suppressed.current = false;
    clearOpen();
    if (!open || closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      // 模型筛选会改变菜单边界，输入法候选窗也可能使指针暂时离开；输入仍聚焦时不按悬停退出关闭。
      if (isWeb) {
        const content = contentRef.current as unknown as HTMLElement | null;
        const active = document.activeElement;
        if (
          content &&
          active &&
          content.contains(active) &&
          active.matches("input,textarea,[contenteditable=true]")
        )
          return;
      }
      closedByHover.current = true;
      onOpenChange(false);
    }, 160);
  }, [clearOpen, contentRef, open, onOpenChange]);
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
  // 点击已经由悬停打开的子菜单是确认展开；触摸、键盘或纯点击仍沿用切换。
  return useCallback(() => {
    clearOpen();
    clearClose();
    suppressed.current = false;
    if (open && openedByHover.current) return;
    onOpenChange(!open);
  }, [clearOpen, clearClose, onOpenChange, open]);
}

export function resolveHoverMenuEnabled(
  openOnHover: boolean | undefined,
  isCompact: boolean,
  disabled: boolean,
): boolean {
  return openOnHover === true && !isCompact && !disabled;
}
