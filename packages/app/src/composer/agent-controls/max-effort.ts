export function isMaxEffort(
  options: readonly { id: string }[] | undefined,
  selectedId: string | undefined,
): boolean {
  if (!options || options.length < 2 || selectedId === undefined) return false;
  return options[options.length - 1].id === selectedId;
}
