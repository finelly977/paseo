import { useCallback, useEffect, useId, useRef } from "react";
import { create } from "zustand";

// 预览属于侧栏的同一显示槽，不能让每一行在关闭宽限期内各自保留卡片。
const useActiveCard = create<{ id: string | null }>(() => ({ id: null }));
const HOVER_GRACE_MS = 100;

export function useWorkspaceHoverCardVisibility(isDragging = false) {
  const id = useId();
  const open = useActiveCard((state) => state.id === id);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearGraceTimer = useCallback(() => {
    if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    graceTimer.current = null;
  }, []);
  const openCard = useCallback(() => {
    clearGraceTimer();
    if (!isDragging) useActiveCard.setState({ id });
  }, [id, isDragging, clearGraceTimer]);
  const closeCard = useCallback(() => {
    clearGraceTimer();
    // 已被另一行替代的旧计时器或卸载清理，不得关闭新行的预览。
    useActiveCard.setState((state) => (state.id === id ? { id: null } : state));
  }, [id, clearGraceTimer]);
  const scheduleClose = useCallback(() => {
    if (graceTimer.current !== null) return;
    graceTimer.current = setTimeout(closeCard, HOVER_GRACE_MS);
  }, [closeCard]);
  useEffect(() => {
    if (!open) clearGraceTimer();
    if (isDragging) closeCard();
  }, [open, isDragging, clearGraceTimer, closeCard]);
  useEffect(() => closeCard, [closeCard]);
  return { open: open && !isDragging, openCard, closeCard, scheduleClose, clearGraceTimer };
}
