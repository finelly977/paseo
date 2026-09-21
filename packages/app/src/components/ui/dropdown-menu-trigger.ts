interface PropagationEvent {
  stopPropagation(): void;
}

export function activateDropdownMenuTrigger<TEvent extends PropagationEvent>({
  event,
  disabled,
  open,
  setOpen,
  onPress,
}: {
  event: TEvent;
  disabled: boolean | null | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  onPress?: (event: TEvent) => void;
}): void {
  event.stopPropagation();
  if (disabled) return;
  onPress?.(event);
  setOpen(!open);
}
