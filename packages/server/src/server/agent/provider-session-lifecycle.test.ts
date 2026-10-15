import { afterEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentSession,
  RenameNativeSessionTitleInput,
} from "./agent-sdk-types.js";
import { wrapClientProvider } from "./provider-registry.js";

class NativeSessionClient implements AgentClient {
  readonly provider = "codex";
  readonly capabilities = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: false,
    supportsMcpServers: false,
    supportsReasoningStream: false,
    supportsToolInvocations: true,
    supportsSessionRename: true,
  };
  title = "原生旧名";
  archived = false;
  failure: Error | null = null;
  readonly handles: AgentPersistenceHandle[] = [];

  async createSession(): Promise<AgentSession> {
    throw new Error("元数据操作不应创建运行时");
  }

  async resumeSession(): Promise<AgentSession> {
    throw new Error("元数据操作不应恢复或取消归档运行时");
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async isAvailable() {
    return true;
  }

  async getNativeSessionTitle(handle: AgentPersistenceHandle) {
    this.handles.push(handle);
    return this.title;
  }

  async renameNativeSessionTitle({ handle, title }: RenameNativeSessionTitleInput) {
    this.handles.push(handle);
    if (this.failure) throw this.failure;
    this.title = title;
  }

  async archiveNativeSession(handle: AgentPersistenceHandle) {
    this.handles.push(handle);
    if (this.failure) throw this.failure;
    this.archived = true;
  }

  async unarchiveNativeSession(handle: AgentPersistenceHandle) {
    this.handles.push(handle);
    if (this.failure) throw this.failure;
    this.archived = false;
  }
}

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "paseo-native-metadata-"))) {
      throw new Error("测试清理路径超出预期目录");
    }
    await rm(directory, { recursive: true });
  }
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-native-metadata-"));
  directories.push(directory);
  const logger = createTestLogger();
  const storage = new AgentStorage(directory, logger);
  const native = new NativeSessionClient();
  const client = wrapClientProvider("codex-profile", native, [], [], false);
  const manager = new AgentManager({
    clients: { "codex-profile": client },
    registry: storage,
    logger,
  });
  const agentId = randomUUID();
  await storage.upsert({
    id: agentId,
    provider: "codex-profile",
    cwd: directory,
    title: "Paseo 旧名",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStatus: "closed",
    labels: {},
    persistence: { provider: "codex-profile", sessionId: "session-id", nativeHandle: "native-id" },
  });
  return { agentId, storage, native, client, manager };
}

test("派生提供方透传原生读名、改名、归档和取消归档，并映射原生提供方身份", async () => {
  const { client, native } = await setup();
  const handle = { provider: "codex-profile", sessionId: "session-id", nativeHandle: "native-id" };
  await expect(client.getNativeSessionTitle?.(handle)).resolves.toBe("原生旧名");
  await client.renameNativeSessionTitle?.({ handle, title: "原生新名" });
  await client.archiveNativeSession?.(handle);
  expect(native.archived).toBe(true);
  await client.unarchiveNativeSession?.(handle);
  expect(native.archived).toBe(false);
  expect(native.title).toBe("原生新名");
  expect(native.handles).toEqual(
    Array.from({ length: 4 }, () => ({ ...handle, provider: "codex" })),
  );
});

test("归档会话不能直接原生改名时保留本地名称，不擅自恢复运行时或取消归档", async () => {
  const { manager, native, storage, agentId } = await setup();
  const record = await storage.get(agentId);
  if (!record) throw new Error("缺少测试记录");
  await storage.upsert({ ...record, archivedAt: "2026-01-02T00:00:00.000Z" });
  native.archived = true;
  native.failure = new Error("请先取消归档");
  await expect(manager.updateAgentMetadata(agentId, { title: "归档会话的新名" })).rejects.toThrow(
    "请先取消归档",
  );
  expect(native.title).toBe("原生旧名");
  expect(native.archived).toBe(true);
  expect(await storage.get(agentId)).toMatchObject({
    title: "Paseo 旧名",
    archivedAt: "2026-01-02T00:00:00.000Z",
  });
  expect(manager.getAgent(agentId)).toBeNull();
});

test("原生改名失败不保存 Paseo 标题，重试成功后才更新", async () => {
  const { manager, native, storage, agentId } = await setup();
  native.failure = new Error("原生改名失败");
  await expect(manager.updateAgentMetadata(agentId, { title: "新名" })).rejects.toThrow(
    "原生改名失败",
  );
  expect((await storage.get(agentId))?.title).toBe("Paseo 旧名");
  native.failure = null;
  await manager.updateAgentMetadata(agentId, { title: "新名" });
  expect(native.title).toBe("新名");
  expect((await storage.get(agentId))?.title).toBe("新名");
});

test("归档必须经过包装后的原生钩子，原生失败时本地仍保持未归档", async () => {
  const { manager, native, storage, agentId } = await setup();
  native.failure = new Error("原生归档失败");
  await expect(manager.archiveSnapshot(agentId, new Date().toISOString())).rejects.toThrow(
    "原生归档失败",
  );
  expect((await storage.get(agentId))?.archivedAt).toBeUndefined();
  native.failure = null;
  await manager.archiveSnapshot(agentId, new Date().toISOString());
  expect(native.archived).toBe(true);
  expect((await storage.get(agentId))?.archivedAt).toBeTruthy();
});
