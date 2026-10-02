import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { createTestAgentClient, createTestAgentClients } from "../test-utils/fake-agent-client.js";

test("热重载期间的历史请求等待同一次恢复，不再次恢复原生线程", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-reload-loading-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const closing = Promise.withResolvers<void>();
  const releaseClose = Promise.withResolvers<void>();
  const releaseResume = Promise.withResolvers<void>();
  const loadReachedBarrier = Promise.withResolvers<void>();
  let closes = 0;
  let resumes = 0;
  const base = createTestAgentClient("codex", {
    closeSession: async () => {
      closes += 1;
      if (closes === 1) {
        closing.resolve();
        await releaseClose.promise;
      }
    },
  });
  const client: AgentClient = {
    provider: base.provider,
    capabilities: base.capabilities,
    createSession: (config, context, options) => base.createSession(config, context, options),
    resumeSession: async (handle, config, context, options) => {
      resumes += 1;
      if (resumes === 2) loadReachedBarrier.resolve();
      await releaseResume.promise;
      return base.resumeSession(handle, config, context, options);
    },
    fetchCatalog: (options) => base.fetchCatalog(options),
    isAvailable: () => base.isAvailable(),
  };
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const loader = {
    getAgent: manager.getAgent.bind(manager),
    getRegisteredProviderIds: manager.getRegisteredProviderIds.bind(manager),
    createAgent: manager.createAgent.bind(manager),
    resumeAgentFromPersistence: manager.resumeAgentFromPersistence.bind(manager),
    hydrateTimelineFromProvider: manager.hydrateTimelineFromProvider.bind(manager),
    reloadAgentSession: manager.reloadAgentSession.bind(manager),
    waitForAgentClose: manager.waitForAgentClose.bind(manager),
    waitForAgentReload: (agentId: string) => {
      loadReachedBarrier.resolve();
      return manager.waitForAgentReload(agentId);
    },
  };
  const agent = await manager.createAgent({ provider: "codex", cwd: root }, undefined, {});
  try {
    const reload = manager.reloadAgentSession(agent.id, undefined, { rehydrateFromDisk: true });
    expect(() => manager.streamAgent(agent.id, "重载过程中不能插入新对话")).toThrow(
      `Agent ${agent.id} already has an active run`,
    );
    await closing.promise;
    const repeatedReload = manager.reloadAgentSession(agent.id, undefined, {
      rehydrateFromDisk: true,
    });
    expect(repeatedReload).toBe(reload);
    const restored = ensureAgentLoaded(agent.id, {
      agentManager: loader,
      agentStorage: storage,
      logger,
    });
    const outcomes = Promise.allSettled([reload, repeatedReload, restored]);
    releaseClose.resolve();
    await loadReachedBarrier.promise;
    releaseResume.resolve();
    const results = await outcomes;
    expect(resumes).toBe(1);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(manager.getAgent(agent.id)?.id).toBe(agent.id);
  } finally {
    releaseClose.resolve();
    releaseResume.resolve();
    if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
    await manager.flush();
    await storage.flush();
    await rm(root, { recursive: true, force: true });
  }
});

test("重载只在官方历史完整提交后通知替换，不逐条广播历史", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-reload-history-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const historyStarted = Promise.withResolvers<void>();
  const releaseHistory = Promise.withResolvers<void>();
  const client = createTestAgentClient("codex", {
    onStreamHistory: async () => {
      historyStarted.resolve();
      await releaseHistory.promise;
    },
  });
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: root }, undefined, {});
  const deliveries: string[] = [];
  const unsubscribe = manager.subscribe((event) => {
    if (event.type === "timeline_replacement") deliveries.push("replacement");
    if (event.type === "agent_stream") deliveries.push("stream");
  });
  try {
    const reload = manager.reloadAgentSession(agent.id, undefined, { rehydrateFromDisk: true });
    const boundary = await Promise.race([
      historyStarted.promise.then(() => "reading"),
      reload.then(() => "returned"),
    ]);
    expect(boundary).toBe("reading");
    expect(deliveries).toEqual([]);
    releaseHistory.resolve();
    await reload;
    expect(deliveries).toEqual(["replacement"]);
    await ensureAgentLoaded(agent.id, { agentManager: manager, agentStorage: storage, logger });
    expect(deliveries).toEqual(["replacement"]);
  } finally {
    releaseHistory.resolve();
    unsubscribe();
    if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
    await manager.flush();
    await storage.flush();
    await rm(root, { recursive: true, force: true });
  }
});

test("配置不同的重载依次完成，历史补载等待最后一次重载", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-reload-config-queue-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const historyStarted = Promise.withResolvers<void>();
  const releaseHistory = Promise.withResolvers<void>();
  let reads = 0;
  const client = createTestAgentClient("codex", {
    onStreamHistory: async () => {
      reads += 1;
      if (reads === 1) {
        historyStarted.resolve();
        await releaseHistory.promise;
      }
    },
  });
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: root }, undefined, {});
  try {
    const first = manager.reloadAgentSession(
      agent.id,
      { model: "gpt-5.4" },
      { rehydrateFromDisk: true },
    );
    await historyStarted.promise;
    const second = manager.reloadAgentSession(
      agent.id,
      { model: "gpt-5.4-mini" },
      { rehydrateFromDisk: true },
    );
    const loaded = ensureAgentLoaded(agent.id, {
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    releaseHistory.resolve();
    const [firstAgent, secondAgent, loadedAgent] = await Promise.all([first, second, loaded]);
    expect(firstAgent.config.model).toBe("gpt-5.4");
    expect(secondAgent.config.model).toBe("gpt-5.4-mini");
    expect(loadedAgent.config.model).toBe("gpt-5.4-mini");
    expect(reads).toBe(2);
  } finally {
    releaseHistory.resolve();
    if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
    await manager.flush();
    await storage.flush();
    await rm(root, { recursive: true, force: true });
  }
});

test("官方历史读取失败释放新运行时，下一次加载能够重试", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-reload-history-failure-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const failure = new Error("official history unavailable");
  let reads = 0;
  const client = createTestAgentClient("codex", {
    onStreamHistory: async () => {
      reads += 1;
      if (reads === 1) throw failure;
    },
  });
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: root }, undefined, {});
  try {
    await expect(
      manager.reloadAgentSession(agent.id, undefined, { rehydrateFromDisk: true }),
    ).rejects.toBe(failure);
    expect(manager.getAgent(agent.id)).toBeNull();
    expect((await storage.get(agent.id))?.lastStatus).toBe("closed");
    const restored = await ensureAgentLoaded(agent.id, {
      agentManager: manager,
      agentStorage: storage,
      logger,
      replaceTimeline: true,
    });
    expect(restored.id).toBe(agent.id);
    expect(reads).toBe(2);
  } finally {
    if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
    await manager.flush();
    await storage.flush();
    await rm(root, { recursive: true, force: true });
  }
});

test("loads archived records for history and active records with the interactive default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-purpose-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  const resumeOptions: Array<AgentResumeSessionOptions | undefined> = [];
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (
      config: AgentSessionConfig,
      launchContext?: AgentLaunchContext,
    ): Promise<AgentSession> => await baseClient.createSession(config, launchContext),
    resumeSession: async (
      handle: AgentPersistenceHandle,
      overrides?: Partial<AgentSessionConfig>,
      launchContext?: AgentLaunchContext,
      options?: AgentResumeSessionOptions,
    ): Promise<AgentSession> => {
      resumeOptions.push(options);
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
  });

  const archivedId = "00000000-0000-4000-8000-000000000301";
  const activeId = "00000000-0000-4000-8000-000000000302";

  try {
    const archived = await manager.createAgent({ provider: "codex", cwd: root }, archivedId, {
      workspaceId: "workspace-archived",
    });
    await manager.archiveAgent(archived.id);

    const active = await manager.createAgent({ provider: "codex", cwd: root }, activeId, {
      workspaceId: "workspace-active",
    });
    await manager.closeAgent(active.id);

    await ensureAgentLoaded(archived.id, { agentManager: manager, agentStorage: storage, logger });
    await ensureAgentLoaded(active.id, { agentManager: manager, agentStorage: storage, logger });

    expect(resumeOptions).toEqual([{ purpose: "history" }, undefined]);
  } finally {
    await Promise.all([
      manager.closeAgent(archivedId).catch(() => undefined),
      manager.closeAgent(activeId).catch(() => undefined),
    ]);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
