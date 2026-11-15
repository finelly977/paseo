export type PointerActivationConstraint =
  | { distance: number }
  | { delay: number; tolerance: number };

export interface DragActivationConfig {
  movementDistance: number;
  touchHoldDelayMs: number;
  touchHoldTolerance: number;
  holdDelayMs?: number;
}

export interface DragActivationConstraints {
  mouse: PointerActivationConstraint;
  touch: PointerActivationConstraint;
}

export function getDragActivationConstraints(
  useDragHandle: boolean,
  config: DragActivationConfig,
): DragActivationConstraints {
  if (config.holdDelayMs !== undefined) {
    const hold = { delay: config.holdDelayMs, tolerance: config.touchHoldTolerance };
    return { mouse: hold, touch: hold };
  }
  const movement = { distance: config.movementDistance };
  const touch = useDragHandle
    ? { delay: config.touchHoldDelayMs, tolerance: config.touchHoldTolerance }
    : movement;

  return { mouse: movement, touch };
}
