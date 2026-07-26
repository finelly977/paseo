import { useCallback, useMemo, useRef, useState } from "react";
import { isWeb } from "@/constants/platform";

interface PointerTargetEvent {
  currentTarget?: unknown;
}

export interface SidebarRowHoverHandlers {
  onPointerEnter: (event: PointerTargetEvent) => void;
  onPointerLeave: () => void;
}

export interface SidebarRowHover {
  isHovered: boolean;
  hoverHandlers: SidebarRowHoverHandlers;
  /**
   * Re-derive hover from the pointer's real position. A row's kebab menu opens a
   * full-screen portal overlay that covers the row, so the row never receives the
   * `pointerleave` for the pointer moving away — it stays highlighted until the next
   * enter/leave pair. Call this when the menu closes.
   */
  revalidateHover: () => void;
}

export function useSidebarRowHover(): SidebarRowHover {
  const [isHovered, setIsHovered] = useState(false);
  // Captured from the enter event rather than a ref prop: the row's ref slot already
  // belongs to the drag activator.
  const nodeRef = useRef<HTMLElement | null>(null);

  const handlePointerEnter = useCallback((event: PointerTargetEvent) => {
    nodeRef.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    setIsHovered(true);
  }, []);

  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const revalidateHover = useCallback(() => {
    if (!isWeb) {
      return;
    }
    // The overlay unmounts in the same commit as the close, so read `:hover` on the
    // next frame — by then the pointer resolves against the surviving tree.
    requestAnimationFrame(() => {
      const node = nodeRef.current;
      setIsHovered(node !== null && node.isConnected && node.matches(":hover"));
    });
  }, []);

  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return { isHovered, hoverHandlers, revalidateHover };
}
