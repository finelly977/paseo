import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  resolveDesktopAppVersion,
  resolveDesktopDaemonStatus,
} from "../../daemon/daemon-manager.js";
import { createNodeEntrypointInvocation } from "../../daemon/runtime-paths.js";
import type { NodeEntrypointInvocation } from "../../daemon/node-entrypoint-launcher.js";
import { resolveMigrationEntrypoint } from "./entrypoint.js";
import { DesktopMigrationProcess, type MigrationTarget } from "./process.js";

const migrations = new DesktopMigrationProcess({
  sources: new Map(process.platform === "darwin" ? [["conductor", ["conductor"]]] : []),
  env: process.env,
  resolveEntrypoint: resolveMigrationEntrypoint,
  createInvocation: ({ entrypoint, args, env }) =>
    createNodeEntrypointInvocation({ entrypoint, argvMode: "node-script", args, baseEnv: env }),
  spawn: (invocation: NodeEntrypointInvocation) =>
    spawn(invocation.command, invocation.args, {
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  getTarget: async (): Promise<MigrationTarget> => {
    const status = await resolveDesktopDaemonStatus();
    return {
      status: status.status,
      desktopManaged: status.desktopManaged,
      listen: status.listen,
      home: status.home,
      appVersion: resolveDesktopAppVersion(),
      daemonVersion: status.version,
      passwordProtected: Boolean(process.env.PASEO_PASSWORD?.trim()) || hasPassword(status.home),
    };
  },
});

export function registerMigrationIpc(): void {
  ipcMain.handle("paseo:migrations:availability", (_event, input: unknown) =>
    migrations.availability(readSource(input)),
  );
  ipcMain.handle("paseo:migrations:run", async (event, input: unknown) => {
    const source = readSource(input);
    return {
      runId: await migrations.run(source, (output) => {
        if (!event.sender.isDestroyed()) event.sender.send("paseo:migrations:output", output);
      }),
    };
  });
}

function readSource(input: unknown): string {
  if (typeof input !== "object" || input === null || !("source" in input)) {
    throw new Error("Migration source is required.");
  }
  const source = (input as { source?: unknown }).source;
  if (typeof source !== "string") throw new Error("Migration source is required.");
  return source;
}

function hasPassword(paseoHome: string): boolean {
  const configPath = path.join(paseoHome, "config.json");
  if (!existsSync(configPath)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      daemon?: { auth?: { password?: unknown } };
    };
    return typeof config.daemon?.auth?.password === "string";
  } catch {
    return true;
  }
}
