export function shouldAutomaticallyCreateWorkspaceShell(input: {
  routeHasProject: boolean;
  hasDraftHandoff: boolean;
  selectedSourceDirectory: string | null;
  clientReady: boolean;
  checkoutReady: boolean;
  isPending: boolean;
}): boolean {
  return (
    input.routeHasProject &&
    !input.hasDraftHandoff &&
    input.selectedSourceDirectory !== null &&
    input.clientReady &&
    input.checkoutReady &&
    !input.isPending
  );
}
