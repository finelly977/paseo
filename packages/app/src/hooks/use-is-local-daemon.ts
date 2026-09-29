import { useQuery } from "@tanstack/react-query";
import { getDesktopDaemonIdentity, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";

const DESKTOP_DAEMON_SERVER_ID_QUERY_KEY = ["desktop-daemon-server-id"] as const;

function useLocalDaemonServerIdQuery() {
  const isDesktopApp = shouldUseDesktopDaemon();

  return useQuery({
    queryKey: DESKTOP_DAEMON_SERVER_ID_QUERY_KEY,
    queryFn: getDesktopDaemonIdentity,
    enabled: isDesktopApp,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: (activeQuery) => (activeQuery.state.data?.serverId ? false : 1000),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLocalDaemonServerId(): string | null {
  const isDesktopApp = shouldUseDesktopDaemon();
  const query = useLocalDaemonServerIdQuery();

  if (!isDesktopApp) {
    return null;
  }

  return query.data?.serverId ?? null;
}

export type LocalDaemonServerIdState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "resolved"; serverId: string | null };

export function useLocalDaemonServerIdState(): LocalDaemonServerIdState {
  const isDesktopApp = shouldUseDesktopDaemon();
  const query = useLocalDaemonServerIdQuery();

  if (!isDesktopApp) {
    return { status: "resolved", serverId: null };
  }
  if (query.isError) {
    return { status: "error" };
  }
  if (query.isSuccess) {
    return { status: "resolved", serverId: query.data.serverId };
  }
  return { status: "loading" };
}

export function useIsLocalDaemon(serverId: string): boolean {
  const normalizedServerId = serverId.trim();
  const localServerId = useLocalDaemonServerId();

  if (localServerId === null || normalizedServerId.length === 0) {
    return false;
  }

  return localServerId === normalizedServerId;
}
