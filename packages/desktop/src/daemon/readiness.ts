import type { LocalDaemonState } from "@getpaseo/cli/dist/commands/daemon/local-daemon.js";
import type { connectToDaemon } from "@getpaseo/cli/dist/utils/client.js";
import type { DesktopDaemonStatus } from "./daemon-manager.js";

interface DaemonReadinessState extends Pick<
  LocalDaemonState,
  "home" | "listen" | "running" | "pidInfo"
> {
  serverId: string;
}

type ReadinessClient = Pick<
  Awaited<ReturnType<typeof connectToDaemon>>,
  "getLastServerInfoMessage" | "close"
>;

export interface DaemonReadinessRuntime {
  readState(home: string): Promise<DaemonReadinessState>;
  connect(input: { host: string; timeout: number }): Promise<ReadinessClient>;
}

const runtime: DaemonReadinessRuntime = {
  async readState(home) {
    const { resolveLocalDaemonState } =
      await import("@getpaseo/cli/dist/commands/daemon/local-daemon.js");
    const { getOrCreateServerId } = await import("@getpaseo/server");
    return { ...resolveLocalDaemonState({ home }), serverId: getOrCreateServerId(home) };
  },
  async connect(input) {
    const { connectToDaemon } = await import("@getpaseo/cli/dist/utils/client.js");
    return connectToDaemon(input);
  },
};

export async function resolveDaemonReadiness(
  home: string,
  deps: DaemonReadinessRuntime = runtime,
): Promise<DesktopDaemonStatus> {
  const state = await deps.readState(home);
  const status: DesktopDaemonStatus = {
    home: state.home,
    serverId: state.serverId,
    status: "stopped",
    listen: state.listen,
    hostname: null,
    version: null,
    pid: state.running && state.pidInfo ? state.pidInfo.pid : null,
    desktopManaged: state.pidInfo?.desktopManaged === true,
    error: null,
  };
  let client: ReadinessClient;
  try {
    client = await deps.connect({ host: state.listen, timeout: 1500 });
  } catch (error) {
    // 拒绝连接表示尚未监听；超时不能作为回收现有进程的依据。
    if (error instanceof Error && /\b(ECONNREFUSED|ENOENT)\b/.test(error.message)) {
      return { ...status, status: state.running ? "errored" : "stopped" };
    }
    if (error instanceof Error && error.message === "Connection timed out") {
      return { ...status, status: "starting", error: error.message };
    }
    throw error;
  }
  try {
    const info = client.getLastServerInfoMessage();
    if (!info || info.serverId !== state.serverId) {
      throw new Error(
        `Unexpected daemon identity at ${state.listen}: expected ${state.serverId}, received ${info?.serverId ?? "no server_info"}`,
      );
    }
    return {
      ...status,
      status: "running",
      hostname: info.hostname ?? null,
      version: info.version ?? null,
      desktopManaged: info.desktopManaged === true,
    };
  } finally {
    await client.close();
  }
}
