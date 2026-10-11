interface PropagationEvent {
  stopPropagation(): void;
}

export function activateDropdownMenuTrigger<TEvent extends PropagationEvent>({
  event,
  disabled,
  activateMenu,
  onPress,
}: {
  event: TEvent;
  disabled: boolean | null | undefined;
  activateMenu: () => void;
  onPress?: (event: TEvent) => void;
}): void {
  event.stopPropagation();
  if (disabled) return;
  onPress?.(event);
  activateMenu();
}
