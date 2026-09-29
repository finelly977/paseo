import { useCallback, useSyncExternalStore } from "react";
import { useLocalDaemonServerId } from "./use-is-local-daemon";
import { getDaemonStartService } from "@/runtime/daemon-start-service";
import { getHostRuntimeStore, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { resolveLocalHostStartup } from "@/runtime/local-host-startup";

export function useLocalHostStartup(serverId: string) {
  const localServerId = useLocalDaemonServerId();
  const connected = useHostRuntimeIsConnected(serverId);
  const service = getDaemonStartService({ store: getHostRuntimeStore() });
  const subscribe = useCallback((listener: () => void) => service.subscribe(listener), [service]);
  const running = useSyncExternalStore(
    subscribe,
    () => service.isRunning(),
    () => false,
  );
  const error = useSyncExternalStore(
    subscribe,
    () => service.getLastError(),
    () => null,
  );
  const retry = useCallback(() => {
    void service.start();
  }, [service]);
  return {
    status: resolveLocalHostStartup({ serverId, localServerId, connected, running, error }),
    error,
    retry,
  };
}
