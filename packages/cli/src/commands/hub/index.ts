import { Command } from "commander";
import { withOutput, type ListResult, type OutputSchema } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { connectToDaemon } from "../../utils/client.js";
import { DaemonPermissionSchema, type DaemonPermission } from "@getpaseo/protocol/messages";

interface HubRow {
  state: string;
  daemonId: string | null;
  hub: string | null;
  permissions: string;
  connectedAt: string | null;
  error: string | null;
  warning?: string;
}

const schema: OutputSchema<HubRow> = {
  idField: "state",
  columns: [
    { header: "STATE", field: "state" },
    { header: "HUB", field: "hub" },
    { header: "DAEMON", field: "daemonId" },
    { header: "PERMISSIONS", field: "permissions" },
    { header: "CONNECTED", field: "connectedAt" },
    { header: "ERROR", field: "error" },
    { header: "WARNING", field: "warning" },
  ],
};

function result(
  status: {
    state: string;
    daemonId: string | null;
    hubOrigin: string | null;
    permissions: DaemonPermission[];
    connectedAt: string | null;
    lastError: string | null;
  },
  warning?: string,
): ListResult<HubRow> {
  return {
    type: "list",
    data: [
      {
        state: status.state,
        daemonId: status.daemonId,
        hub: status.hubOrigin,
        permissions: status.permissions.join(", "),
        connectedAt: status.connectedAt,
        error: status.lastError,
        warning,
      },
    ],
    schema,
  };
}

async function withClient<T>(
  host: string | undefined,
  action: (client: Awaited<ReturnType<typeof connectToDaemon>>) => Promise<T>,
): Promise<T> {
  const client = await connectToDaemon({ host });
  let actionOutcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    actionOutcome = { ok: true, value: await action(client) };
  } catch (error) {
    actionOutcome = { ok: false, error };
  }
  if (!actionOutcome.ok) {
    let closeFailure: { error: unknown } | null = null;
    try {
      await client.close();
    } catch (closeError) {
      closeFailure = { error: closeError };
    }
    if (closeFailure) {
      throw new AggregateError(
        [actionOutcome.error, closeFailure.error],
        "Hub command failed and the daemon client could not be closed",
      );
    }
    throw actionOutcome.error;
  }
  await client.close();
  return actionOutcome.value;
}

function parseDaemonPermission(value: string): DaemonPermission {
  return DaemonPermissionSchema.parse(value);
}

function parseDaemonPermissions(values: readonly string[] | undefined): DaemonPermission[] {
  return values?.map(parseDaemonPermission) ?? [];
}

function readCommandOption(options: unknown, key: string): unknown {
  if (typeof options !== "object" || options === null) {
    throw new Error("Hub command options are missing");
  }
  return Reflect.get(options, key);
}

function parseHostOption(options: unknown): string | undefined {
  const host = readCommandOption(options, "host");
  if (host !== undefined && typeof host !== "string") {
    throw new Error("Hub daemon host option must be a string");
  }
  return host;
}

function parseConnectOptions(options: unknown): {
  token: string;
  host?: string;
  permission?: DaemonPermission[];
} {
  const token = readCommandOption(options, "token");
  if (typeof token !== "string") throw new Error("Hub token option must be a string");
  const permission = DaemonPermissionSchema.array()
    .optional()
    .parse(readCommandOption(options, "permission"));
  const host = parseHostOption(options);
  return {
    token,
    ...(host !== undefined ? { host } : {}),
    ...(permission !== undefined ? { permission } : {}),
  };
}

function parseDisconnectOptions(options: unknown): { host?: string; force: boolean } {
  const force = readCommandOption(options, "force");
  if (force !== undefined && typeof force !== "boolean") {
    throw new Error("Hub force option must be a boolean");
  }
  const host = parseHostOption(options);
  return { ...(host !== undefined ? { host } : {}), force: force ?? false };
}

function samePermissions(
  actual: readonly DaemonPermission[],
  expected: readonly DaemonPermission[],
) {
  return (
    actual.length === expected.length && expected.every((permission) => actual.includes(permission))
  );
}

async function rejectUnhonoredPermissions(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  actual: readonly DaemonPermission[],
  expected: readonly DaemonPermission[],
): Promise<void> {
  if (samePermissions(actual, expected)) return;

  const mismatch = new Error("The daemon did not honor the requested Hub permissions");
  let cleanupFailure: { error: unknown } | null = null;
  try {
    await client.disconnectHub(false);
  } catch (cleanupError) {
    cleanupFailure = { error: cleanupError };
  }
  if (cleanupFailure) {
    throw new AggregateError(
      [mismatch, cleanupFailure.error],
      "The daemon returned mismatched Hub permissions and the compensating disconnect failed",
    );
  }
  throw mismatch;
}

export function createHubCommand(): Command {
  const hub = new Command("hub").description("管理当前守护进程与 Paseo Hub 的关系");
  addJsonAndDaemonHostOptions(
    hub
      .command("connect")
      .argument("<url>")
      .requiredOption("--token <token>")
      .option("--permission <permission...>", "连接时授予守护进程权限"),
  ).action(
    withOutput(async (...args) => {
      const url = args[0];
      if (typeof url !== "string") throw new Error("Hub URL argument must be a string");
      const options = parseConnectOptions(args.at(-2));
      const permissions = parseDaemonPermissions(options.permission);
      return withClient(options.host, async (client) => {
        const response = await client.connectHub(url, options.token, permissions);
        await rejectUnhonoredPermissions(client, response.status.permissions, permissions);
        return result(response.status);
      });
    }),
  );
  addJsonAndDaemonHostOptions(hub.command("status")).action(
    withOutput(async (...args) => {
      const host = parseHostOption(args.at(-2));
      return withClient(host, async (client) => result((await client.getHubStatus()).status));
    }),
  );
  addJsonAndDaemonHostOptions(
    hub.command("disconnect").option("--force", "即使 Hub 离线也移除本地授权"),
  ).action(
    withOutput(async (...args) => {
      const options = parseDisconnectOptions(args.at(-2));
      return withClient(options.host, async (client) => {
        const response = await client.disconnectHub(options.force);
        return result(response.status, response.warning);
      });
    }),
  );

  const permissions = hub.command("permissions").description("管理当前 Hub 的守护进程权限");
  addJsonAndDaemonHostOptions(permissions.command("list")).action(
    withOutput(async (...args) => {
      const host = parseHostOption(args.at(-2));
      return withClient(host, async (client) => result((await client.getHubStatus()).status));
    }),
  );
  for (const operation of ["grant", "revoke"] as const) {
    addJsonAndDaemonHostOptions(
      permissions.command(operation).argument("<permission>", "守护进程权限"),
    ).action(
      withOutput(async (...args) => {
        const permissionArgument = args[0];
        if (typeof permissionArgument !== "string") {
          throw new Error("Hub permission argument must be a string");
        }
        const permission = parseDaemonPermission(permissionArgument);
        const host = parseHostOption(args.at(-2));
        return withClient(host, async (client) => {
          const response = await client.updateHubPermissions(
            operation === "grant" ? { grant: [permission] } : { revoke: [permission] },
          );
          return result(response.status);
        });
      }),
    );
  }
  return hub;
}
