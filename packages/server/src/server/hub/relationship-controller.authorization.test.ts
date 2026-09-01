import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { HubExecutionAgents } from "./daemon-executions.js";
import {
  HubRelationshipController,
  type HubRelationshipClock,
  type ScheduledRelationshipTask,
} from "./relationship-controller.js";
import type {
  HubEnrollment,
  HubPermissionUpdate,
  HubRelationshipRemote,
  HubRevocation,
  HubSocketConnection,
  HubSocketCredentials,
  HubSocketEvents,
} from "./relationship-remote.js";
import type { WebSocketLike } from "../websocket-server.js";

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }
}

class TestSocket implements WebSocketLike, HubSocketConnection {
  readyState = 1;
  closed = false;

  send(): void {}

  close(): void {
    this.closed = true;
  }

  on(): void {}

  once(): void {}
}

class TestRemote implements HubRelationshipRemote {
  readonly permissionUpdates: HubPermissionUpdate[] = [];
  readonly socket = new TestSocket();
  socketEvents: HubSocketEvents | null = null;
  enrollmentGate: Deferred<void> | null = null;
  permissionUpdateGate: Deferred<void> | null = null;
  enrollmentAttempts = 0;

  async enroll(input: HubEnrollment) {
    this.enrollmentAttempts++;
    await this.enrollmentGate?.promise;
    return {
      daemonId: input.daemonId,
      permissions: input.permissions,
      webSocketUrl: "wss://hub.test/daemon",
    };
  }

  async updatePermissions(input: HubPermissionUpdate): Promise<{ permissions: string[] }> {
    this.permissionUpdates.push({ ...input, permissions: [...input.permissions] });
    const gate = this.permissionUpdateGate;
    this.permissionUpdateGate = null;
    await gate?.promise;
    return { permissions: [...input.permissions] };
  }

  async revoke(_input: HubRevocation): Promise<void> {}

  openSocket(_input: HubSocketCredentials, events: HubSocketEvents): HubSocketConnection {
    this.socketEvents = events;
    return this.socket;
  }
}

class TestClock implements HubRelationshipClock {
  now(): Date {
    return new Date("2026-09-01T00:00:00.000Z");
  }

  schedule(_delayMs: number, _task: () => void): ScheduledRelationshipTask {
    return { cancel() {} };
  }
}

const executionAgents: HubExecutionAgents = {
  async create() {
    throw new Error("测试不应创建智能体");
  },
  subscribe() {
    return () => undefined;
  },
  async invalidateAuthority() {},
};

let paseoHome: string;
let remote: TestRemote;
let controller: HubRelationshipController;
let attachFailure: Error | null;

beforeEach(async () => {
  paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-hub-authorization-"));
  remote = new TestRemote();
  attachFailure = null;
  controller = new HubRelationshipController({
    paseoHome,
    serverId: "server-test",
    daemonPublicKey: "public-key-test",
    logger: pino({ level: "silent" }),
    remote,
    clock: new TestClock(),
    createDaemonId: () => "daemon-test",
    attachSocket: async () => {
      if (attachFailure) throw attachFailure;
    },
    updateAttachedPermissions: () => undefined,
    createExecutionAgents: () => executionAgents,
  });
});

afterEach(async () => {
  await controller.stop();
  await rm(paseoHome, { recursive: true, force: true });
});

test("a pending enrollment rejects a replacement with different permissions", async () => {
  remote.enrollmentGate = new Deferred<void>();
  const firstConnect = controller.connect({
    hubUrl: "https://hub.test",
    token: "first-token",
    permissions: ["hub.execute"],
  });
  await vi.waitFor(() => expect(remote.enrollmentAttempts).toBe(1));

  await expect(
    controller.connect({
      hubUrl: "https://hub.test",
      token: "replacement-token",
      permissions: [],
    }),
  ).rejects.toThrow("different permissions");

  remote.enrollmentGate.resolve(undefined);
  await firstConnect;
  expect(controller.status().permissions).toEqual(["hub.execute"]);
});

test("relationship mutations fail explicitly instead of racing", async () => {
  await controller.connect({
    hubUrl: "https://hub.test",
    token: "token",
    permissions: ["hub.execute"],
  });
  const permissionUpdateGate = new Deferred<void>();
  remote.permissionUpdateGate = permissionUpdateGate;
  const update = controller.updatePermissions({ grant: ["daemon.read"], revoke: [] });
  await vi.waitFor(() => expect(remote.permissionUpdates).toHaveLength(1));

  await expect(controller.disconnect({ force: true })).rejects.toThrow(
    "while Hub relationship operation update permissions is running",
  );

  permissionUpdateGate.resolve(undefined);
  await update;
  expect(controller.status().permissions).toEqual(["hub.execute", "daemon.read"]);
});

test("a local persistence failure restores the previous remote permission grant", async () => {
  await controller.connect({
    hubUrl: "https://hub.test",
    token: "token",
    permissions: ["hub.execute"],
  });
  const relationshipPath = path.join(paseoHome, "hub-relationship.json");
  const backupPath = path.join(paseoHome, "hub-relationship.backup.json");
  await rename(relationshipPath, backupPath);
  await mkdir(relationshipPath);

  try {
    await expect(
      controller.updatePermissions({ grant: ["daemon.read"], revoke: [] }),
    ).rejects.toThrow();
  } finally {
    await rm(relationshipPath, { recursive: true });
    await rename(backupPath, relationshipPath);
  }

  expect(remote.permissionUpdates.map((input) => input.permissions)).toEqual([
    ["hub.execute", "daemon.read"],
    ["hub.execute"],
  ]);
  expect(controller.status().permissions).toEqual(["hub.execute"]);
});

test("a failed Hub session attachment closes the socket and schedules reconnection", async () => {
  await controller.connect({
    hubUrl: "https://hub.test",
    token: "token",
    permissions: ["hub.execute"],
  });
  attachFailure = new Error("session attachment failed");
  remote.socketEvents?.connected(remote.socket, "session-v1");

  await vi.waitFor(() => expect(controller.status().state).toBe("reconnecting"));
  expect(controller.status().lastError).toBe("session attachment failed");
  expect(remote.socket.closed).toBe(true);
});
