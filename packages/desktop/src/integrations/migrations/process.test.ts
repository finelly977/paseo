import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { expect, test } from "vitest";
import {
  DesktopMigrationProcess,
  type DesktopMigrationOutput,
  type MigrationTarget,
} from "./process.js";

const eligibleTarget: MigrationTarget = {
  status: "running",
  desktopManaged: true,
  listen: "unix:///tmp/paseo.sock",
  home: "/tmp/paseo-home",
  appVersion: "0.1.110",
  daemonVersion: "0.1.110",
  passwordProtected: false,
};

test("launches the exact version-matched bundled command and streams completion", async () => {
  const child = fakeChild();
  const invocations: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const outputs: DesktopMigrationOutput[] = [];
  const migrations = new DesktopMigrationProcess({
    env: {
      HOME: "/Users/fixture",
      PATH: "/usr/bin",
      PASEO_PASSWORD: "must-not-leak",
      PASEO_HOST: "tcp://remote:6767?password=must-not-leak",
      PASEO_LISTEN: "0.0.0.0:6767",
      AWS_SECRET_ACCESS_KEY: "arbitrary-credential",
      NODE_OPTIONS: "--require=/tmp/untrusted.js",
    },
    sources: new Map([["source-fixture", ["adapter-command"]]]),
    getTarget: async () => eligibleTarget,
    resolveEntrypoint: () => ({
      version: "0.1.110",
      entryPath: "/app/@getpaseo/migrate/dist/cli.js",
      execArgv: [],
    }),
    createInvocation: ({ args, env }) => {
      invocations.push({ args, env });
      return { command: "/app/Paseo", args: ["runner.js", "node-script", "cli.js", ...args], env };
    },
    spawn: () => child.process,
  });

  const runId = await migrations.run("source-fixture", (output) => outputs.push(output));
  child.stdout.write("Found one project\n");
  child.stderr.write("warning\n");
  child.emitExit(0);
  child.stdout.write("Migration complete\n");
  child.emitClose(0);

  expect(invocations).toEqual([
    {
      args: ["adapter-command", "--yes"],
      env: {
        HOME: "/Users/fixture",
        PATH: "/usr/bin",
        PASEO_HOME: "/tmp/paseo-home",
      },
    },
  ]);
  expect(outputs).toEqual([
    { runId, stream: "stdout", chunk: "Found one project\n" },
    { runId, stream: "stderr", chunk: "warning\n" },
    { runId, stream: "stdout", chunk: "Migration complete\n" },
    { runId, stream: "status", exitCode: 0 },
  ]);
  expect(invocations[0]?.env.PASEO_PASSWORD).toBeUndefined();
  expect(invocations[0]?.env.PASEO_HOST).toBeUndefined();
  expect(invocations[0]?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(invocations[0]?.env.NODE_OPTIONS).toBeUndefined();
});

test("allows only one migration process at a time", async () => {
  const child = fakeChild();
  const migrations = createMigrations(eligibleTarget, child.process);

  await migrations.run("source-fixture", () => undefined);
  await expect(migrations.run("source-fixture", () => undefined)).rejects.toThrow(
    "A migration is already running.",
  );
  child.emitExit(0);
  await expect(migrations.run("source-fixture", () => undefined)).rejects.toThrow(
    "A migration is already running.",
  );
  child.emitClose(0);
  await expect(migrations.run("source-fixture", () => undefined)).resolves.toEqual(
    expect.any(String),
  );
});

test.each([
  [{ ...eligibleTarget, passwordProtected: true }, "password-protected"],
  [{ ...eligibleTarget, listen: "10.0.0.5:6767" }, "nonlocal"],
] as const)("rejects an ineligible target before spawn", async (target, reason) => {
  let spawned = false;
  const child = fakeChild();
  const migrations = createMigrations(target, child.process, () => {
    spawned = true;
  });

  await expect(migrations.run("source-fixture", () => undefined)).rejects.toThrow(reason);
  expect(spawned).toBe(false);
});

test.each([
  [{ ...eligibleTarget, status: "stopped" as const }, "host-not-running"],
  [{ ...eligibleTarget, listen: "10.0.0.5:6767" }, "nonlocal-host"],
  [{ ...eligibleTarget, passwordProtected: true }, "password-protected"],
  [{ ...eligibleTarget, daemonVersion: "0.1.109" }, "host-version-mismatch"],
] as const)("returns a localizable availability reason", async (target, reason) => {
  const migrations = createMigrations(target, fakeChild().process);

  await expect(migrations.availability("source-fixture")).resolves.toEqual({
    available: false,
    reason,
  });
});

test.each(["[::1]:6767", "::1:6767"])("accepts local IPv6 listen address %s", async (listen) => {
  const migrations = createMigrations({ ...eligibleTarget, listen }, fakeChild().process);

  await expect(migrations.availability("source-fixture")).resolves.toEqual({
    available: true,
    reason: null,
  });
});

test("reports a bundled package version mismatch before spawn", async () => {
  const child = fakeChild();
  const migrations = createMigrations(eligibleTarget, child.process, undefined, "0.1.109");

  await expect(migrations.run("source-fixture", () => undefined)).rejects.toThrow(
    "bundled migrator version",
  );
});

test("returns a localizable bundled-version availability reason", async () => {
  const migrations = createMigrations(eligibleTarget, fakeChild().process, undefined, "0.1.109");

  await expect(migrations.availability("source-fixture")).resolves.toEqual({
    available: false,
    reason: "migrator-version-mismatch",
  });
});

test("rejects an unregistered opaque source before target lookup or spawn", async () => {
  let targetRead = false;
  let spawned = false;
  const child = fakeChild();
  const migrations = new DesktopMigrationProcess({
    env: {},
    sources: new Map([["known-source", ["known-adapter"]]]),
    getTarget: async () => {
      targetRead = true;
      return eligibleTarget;
    },
    resolveEntrypoint: () => ({ version: "0.1.110", entryPath: "/app/migrate.js", execArgv: [] }),
    createInvocation: ({ env }) => ({ command: "/app/Paseo", args: [], env }),
    spawn: () => {
      spawned = true;
      return child.process;
    },
  });

  await expect(migrations.run("unknown-source", () => undefined)).rejects.toThrow(
    "Unsupported migration source: unknown-source",
  );
  expect(targetRead).toBe(false);
  expect(spawned).toBe(false);
});

function createMigrations(
  target: MigrationTarget,
  child: ChildProcess,
  onSpawn?: () => void,
  entrypointVersion = "0.1.110",
): DesktopMigrationProcess {
  return new DesktopMigrationProcess({
    env: {},
    sources: new Map([["source-fixture", ["source-fixture"]]]),
    getTarget: async () => target,
    resolveEntrypoint: () => ({
      version: entrypointVersion,
      entryPath: "/app/migrate.js",
      execArgv: [],
    }),
    createInvocation: ({ env }) => ({ command: "/app/Paseo", args: [], env }),
    spawn: () => {
      onSpawn?.();
      return child;
    },
  });
}

function fakeChild(): {
  process: ChildProcess;
  stdout: PassThrough;
  stderr: PassThrough;
  emitExit(code: number): void;
  emitClose(code: number): void;
} {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const process = events as ChildProcess;
  Object.assign(process, { stdout, stderr });
  return {
    process,
    stdout,
    stderr,
    emitExit: (code) => events.emit("exit", code, null),
    emitClose: (code) => events.emit("close", code, null),
  };
}
