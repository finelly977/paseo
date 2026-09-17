import { useCallback } from "react";
import type { CodexProviderInjection } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";

export function useCodexProviderInjections(serverId: string | null): {
  injections: CodexProviderInjection[] | null;
  isSupported: boolean;
  saveInjections: (next: CodexProviderInjection[]) => Promise<void>;
} {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore(
    (state) =>
      state.sessions[serverId ?? ""]?.serverInfo?.features?.codexProviderInjection === true,
  );
  const saveInjections = useCallback(
    async (next: CodexProviderInjection[]) => {
      await patchConfig({ codexProviderInjections: next });
    },
    [patchConfig],
  );

  return {
    injections: config ? (config.codexProviderInjections ?? []) : null,
    isSupported,
    saveInjections,
  };
}
