import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { NodeEntrypointInvocation } from "../../daemon/node-entrypoint-launcher.js";
import type { MigrationEntrypoint } from "./entrypoint.js";

export interface MigrationTarget {
  status: "starting" | "running" | "stopped" | "errored";
  desktopManaged: boolean;
  listen: string | null;
  home: string;
  appVersion: string;
  daemonVersion: string | null;
  passwordProtected: boolean;
}

export interface DesktopMigrationOutput {
  runId: string;
  stream: "stdout" | "stderr" | "status";
  chunk?: string;
  exitCode?: number;
}

export type MigrationUnavailableReason =
  | "unsupported-source"
  | "host-not-running"
  | "nonlocal-host"
  | "password-protected"
  | "host-version-mismatch"
  | "migrator-version-mismatch"
  | "unavailable";

interface MigrationProcessDependencies {
  sources: ReadonlyMap<string, readonly string[]>;
  getTarget(): Promise<MigrationTarget>;
  resolveEntrypoint(): MigrationEntrypoint;
  createInvocation(input: {
    entrypoint: MigrationEntrypoint;
    args: string[];
    env: NodeJS.ProcessEnv;
  }): NodeEntrypointInvocation;
  spawn(invocation: NodeEntrypointInvocation): ChildProcess;
  env: NodeJS.ProcessEnv;
}

export class DesktopMigrationProcess {
  private activeRunId: string | null = null;

  constructor(private readonly dependencies: MigrationProcessDependencies) {}

  async availability(
    source: string,
  ): Promise<{ available: boolean; reason: MigrationUnavailableReason | null }> {
    try {
      this.requireSourceArgs(source);
      const target = await this.dependencies.getTarget();
      assertEligibleTarget(target);
      const entrypoint = this.dependencies.resolveEntrypoint();
      if (normalizeVersion(entrypoint.version) !== normalizeVersion(target.appVersion)) {
        throw new MigrationEligibilityError(
          "migrator-version-mismatch",
          "The bundled migrator version does not match Paseo Desktop.",
        );
      }
      return { available: true, reason: null };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof MigrationEligibilityError ? error.reason : "unavailable",
      };
    }
  }

  async run(source: string, emit: (output: DesktopMigrationOutput) => void): Promise<string> {
    const sourceArgs = this.requireSourceArgs(source);
    if (this.activeRunId) throw new Error("A migration is already running.");
    this.activeRunId = "starting";
    let child: ChildProcess;
    let runId: string;
    try {
      const target = await this.dependencies.getTarget();
      assertEligibleTarget(target);
      const entrypoint = this.dependencies.resolveEntrypoint();
      if (normalizeVersion(entrypoint.version) !== normalizeVersion(target.appVersion)) {
        throw new MigrationEligibilityError(
          "migrator-version-mismatch",
          "The bundled migrator version does not match Paseo Desktop.",
        );
      }

      runId = randomUUID();
      const env = migrationEnvironment(this.dependencies.env, target.home);
      const invocation = this.dependencies.createInvocation({
        entrypoint,
        args: [...sourceArgs, "--yes"],
        env,
      });
      child = this.dependencies.spawn(invocation);
      this.activeRunId = runId;
    } catch (error) {
      this.activeRunId = null;
      throw error;
    }
    let settled = false;
    child.stdout?.on("data", (chunk: Buffer | string) => {
      emit({ runId, stream: "stdout", chunk: chunk.toString() });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      emit({ runId, stream: "stderr", chunk: chunk.toString() });
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      this.activeRunId = null;
      emit({ runId, stream: "stderr", chunk: `${error.message}\n` });
      emit({ runId, stream: "status", exitCode: 1 });
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      this.activeRunId = null;
      emit({ runId, stream: "status", exitCode: code ?? 1 });
    });
    return runId;
  }

  private requireSourceArgs(source: string): readonly string[] {
    const args = this.dependencies.sources.get(source);
    if (!args) {
      throw new MigrationEligibilityError(
        "unsupported-source",
        `Unsupported migration source: ${source}`,
      );
    }
    return args;
  }
}

export function assertEligibleTarget(target: MigrationTarget): void {
  if (target.status !== "running" || !target.desktopManaged) {
    throw new MigrationEligibilityError(
      "host-not-running",
      "Import requires the running Paseo Desktop-managed host.",
    );
  }
  if (!isLocalListen(target.listen)) {
    throw new MigrationEligibilityError(
      "nonlocal-host",
      "Import is unavailable for a nonlocal host.",
    );
  }
  if (target.passwordProtected) {
    throw new MigrationEligibilityError(
      "password-protected",
      "Import is unavailable while the local host is password-protected.",
    );
  }
  if (normalizeVersion(target.daemonVersion) !== normalizeVersion(target.appVersion)) {
    throw new MigrationEligibilityError(
      "host-version-mismatch",
      "Update the Desktop-managed host before importing.",
    );
  }
}

class MigrationEligibilityError extends Error {
  constructor(
    readonly reason: MigrationUnavailableReason,
    message: string,
  ) {
    super(message);
  }
}

function isLocalListen(listen: string | null): boolean {
  if (!listen) return false;
  if (listen.startsWith("unix://") || listen.startsWith("pipe://") || listen.startsWith("/")) {
    return true;
  }
  const endpoint = listen.replace(/^tcp:\/\//, "").toLowerCase();
  if (endpoint.startsWith("[::1]:")) return true;
  const host = endpoint.split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function migrationEnvironment(env: NodeJS.ProcessEnv, paseoHome: string): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { PASEO_HOME: paseoHome };
  for (const name of [
    "HOME",
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
  ]) {
    if (env[name] !== undefined) childEnv[name] = env[name];
  }
  return childEnv;
}

function normalizeVersion(version: string | null): string | null {
  return version?.trim().replace(/^v/i, "") || null;
}
