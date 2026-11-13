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
  const composing = useRef(false);
  const pointerOutside = useRef(false);
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
    pointerOutside.current = false;
    clearClose();
    if (open || suppressed.current || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      openedByHover.current = true;
      onOpenChange(true);
    }, 100);
  }, [clearClose, open, onOpenChange]);
  const leave = useCallback(() => {
    pointerOutside.current = true;
    suppressed.current = false;
    clearOpen();
    if (!open || closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      // 只保护正在选词的输入法，搜索框自动聚焦不能永久阻止悬停关闭。
      if (composing.current) return;
      closedByHover.current = true;
      onOpenChange(false);
    }, 160);
  }, [clearOpen, open, onOpenChange]);
  useEffect(() => {
    if (!isWeb || !enabled || !open) return;
    const start = (event: CompositionEvent) => {
      const content = contentRef.current as unknown as HTMLElement | null;
      if (content && event.target instanceof Node && content.contains(event.target)) {
        composing.current = true;
      }
    };
    const end = () => {
      if (!composing.current) return;
      composing.current = false;
      if (pointerOutside.current) leave();
    };
    document.addEventListener("compositionstart", start, true);
    document.addEventListener("compositionend", end, true);
    return () => {
      composing.current = false;
      document.removeEventListener("compositionstart", start, true);
      document.removeEventListener("compositionend", end, true);
    };
  }, [contentRef, enabled, leave, open]);
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
