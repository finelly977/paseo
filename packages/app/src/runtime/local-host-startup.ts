export interface LocalHostStartupInput {
  serverId: string | null;
  localServerId: string | null;
  connected: boolean;
  running: boolean;
  error: string | null;
}

export function resolveLocalHostStartup(input: LocalHostStartupInput): "starting" | "error" | null {
  if (!input.localServerId || input.serverId !== input.localServerId || input.connected)
    return null;
  if (input.running) return "starting";
  return input.error ? "error" : null;
}
