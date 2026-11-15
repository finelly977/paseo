import { useCallback, useReducer } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";
import { reorderItemsOnDragEnd } from "./reorder-items";

export interface DragReorderHandlers {
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface DragReorderState<T> {
  activeId: string | null;
  items: T[];
  handlers: DragReorderHandlers;
}

export function useDragReorderState<T>({
  data,
  keyExtractor,
  onDragEnd,
  onDragBegin,
  onDragRelease,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onDragEnd?: (items: T[]) => void;
  onDragBegin?: () => void;
  onDragRelease?: () => void;
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer<T>, undefined, dragStateInitial<T>);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      dispatch({ type: "start", id: String(event.active.id), data });
      onDragBegin?.();
    },
    [data, disabled, onDragBegin],
  );

  const clearDragState = useCallback(() => {
    dispatch({ type: "clear" });
    onDragRelease?.();
  }, [onDragRelease]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const items = state.dragItems ?? data;
      dispatch({ type: "clear" });
      onDragRelease?.();
      if (disabled) return;

      const reordered = reorderItemsOnDragEnd({
        items,
        activeId: String(active.id),
        overId: over ? String(over.id) : null,
        keyExtractor,
      });
      if (reordered) onDragEnd?.(reordered);
    },
    [data, disabled, keyExtractor, onDragEnd, onDragRelease, state.dragItems],
  );

  return {
    activeId: state.activeId,
    items: state.dragItems ?? data,
    handlers: {
      onDragStart: handleDragStart,
      onDragCancel: clearDragState,
      onDragEnd: handleDragEnd,
    },
  };
}
