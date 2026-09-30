import pino from "pino";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import type { AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentClient, CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const CODEX_PROVIDER = "codex";

interface CollaborationModeRecord {
  name: string;
  mode?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

const TEST_COLLABORATION_MODES: CollaborationModeRecord[] = [
  {
    name: "Code",
    mode: "code",
    developer_instructions: "Built-in code mode",
  },
  {
    name: "Plan",
    mode: "plan",
    developer_instructions: "Built-in plan mode",
  },
];

type CodexFeaturesTestSession = AgentSession;

interface FeaturesHarnessOptions {
  logger?: pino.Logger;
  handlers?: Parameters<typeof createFakeCodexAppServer>[0];
  resumeHandle?: ConstructorParameters<typeof CodexAppServerAgentSession>[1];
}

const FAST_MODEL = {
  id: "gpt-6.1-sol",
  isDefault: true,
  defaultReasoningEffort: "medium",
  serviceTiers: [{ id: "priority", name: "Fast" }],
};

interface CapturedLogEntry {
  level?: number;
  msg?: string;
  [key: string]: unknown;
}

function createCapturedLogger(): { logger: pino.Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(line: string) {
        entries.push(JSON.parse(line) as CapturedLogEntry);
      },
    },
  );
  return { logger, entries };
}

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: CODEX_PROVIDER,
    cwd: "/tmp/codex-fast-mode-test",
    modeId: "auto",
    model: "gpt-5.4",
    ...overrides,
  };
}

function createSessionHarness(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: FeaturesHarnessOptions = {},
): {
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
} {
  const config = createConfig(configOverrides);
  const appServer = createFakeCodexAppServer({
    "collaborationMode/list": () => ({ data: TEST_COLLABORATION_MODES }),
    ...options.handlers,
  });
  const session = new CodexAppServerAgentSession(
    { ...config, provider: CODEX_PROVIDER },
    options.resumeHandle ?? null,
    options.logger ?? createTestLogger(),
    async () => appServer.child,
  ) as CodexFeaturesTestSession;
  return { session, appServer };
}

async function createConnectedSession(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: FeaturesHarnessOptions = {},
): Promise<{
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
}> {
  const harness = createSessionHarness(configOverrides, options);
  await harness.session.connect();
  harness.appServer.assertNoErrors();
  return harness;
}

describe("Codex app-server provider features", () => {
  test("GPT-6 模型按原生目录提供 Fast 开关，不按名称前缀限制", async () => {
    const { session } = await createConnectedSession(
      { model: "gpt-6.1-sol" },
      {
        handlers: {
          "model/list": () => ({
            data: [{ id: "gpt-6.1-sol", serviceTiers: [{ id: "priority", name: "Fast" }] }],
          }),
        },
      },
    );
    try {
      expect(session.features).toEqual([
        expect.objectContaining({ id: "fast_mode", value: false }),
        expect.objectContaining({ id: "plan_mode", value: false }),
      ]);
    } finally {
      await session.close();
    }
  });

  test("本机 Fast 默认值同步到开关，并在新建和发送时使用 priority", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: undefined },
      {
        handlers: {
          "model/list": () => ({ data: [FAST_MODEL] }),
          "config/read": () => ({
            config: { model: FAST_MODEL.id, service_tier: "fast", features: { fast_mode: true } },
          }),
        },
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
      await session.startTurn("验证档位");
      await expect(appServer.waitForRequest("thread/start")).resolves.toMatchObject({
        model: FAST_MODEL.id,
        serviceTier: "priority",
      });
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        serviceTier: "priority",
      });
      expect(
        appServer.requests().filter((request) => request.method === "config/read"),
      ).toHaveLength(1);
      expect(
        appServer.requests().filter((request) => request.method === "model/list"),
      ).toHaveLength(1);
      expect(
        appServer.requests().filter((request) => request.method === "getUserSavedConfig"),
      ).toEqual([]);
    } finally {
      await session.close();
    }
  });

  test("本会话明确关闭 Fast 时覆盖已开启的全局默认值", async () => {
    const { session, appServer } = await createConnectedSession(
      { featureValues: { fast_mode: false } },
      { handlers: { "config/read": () => ({ config: { service_tier: "priority" } }) } },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: false }),
      );
      await session.startTurn("标准模式");
      await expect(appServer.waitForRequest("thread/start")).resolves.toMatchObject({
        serviceTier: "default",
      });
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({ serviceTier: "default" });
    } finally {
      await session.close();
    }
  });

  test("原生模型默认档位会用于新会话，明确关闭仍优先", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: FAST_MODEL.id },
      {
        handlers: {
          "model/list": () => ({ data: [{ ...FAST_MODEL, defaultServiceTier: "priority" }] }),
        },
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
      await session.setFeature?.("fast_mode", false);
      await session.startTurn("标准模式");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({ serviceTier: "default" });
    } finally {
      await session.close();
    }
  });

  test("恢复时未指定模型就保留原生模型，不用全局默认值覆盖", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: undefined },
      {
        resumeHandle: { sessionId: "native-thread" },
        handlers: {
          "config/read": () => ({ config: { model: "gpt-5.4" } }),
          "model/list": () => ({ data: [{ ...FAST_MODEL, id: "gpt-5.4" }, FAST_MODEL] }),
          "thread/resume": () => ({ serviceTier: "priority", model: FAST_MODEL.id }),
        },
      },
    );
    try {
      expect(await appServer.waitForRequest("thread/resume")).not.toHaveProperty("model");
      await expect(session.getRuntimeInfo()).resolves.toMatchObject({ model: FAST_MODEL.id });
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
    } finally {
      await session.close();
    }
  });

  test("恢复会话读取原生 Fast 状态，关闭后下一回合明确清除档位", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      {
        resumeHandle: { sessionId: "native-thread" },
        handlers: {
          "thread/resume": (params) => ({
            serviceTier:
              z.object({ serviceTier: z.string().optional() }).parse(params).serviceTier ??
              "priority",
            model: "gpt-5.4",
          }),
        },
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
      expect(await appServer.waitForRequest("thread/resume")).not.toHaveProperty("serviceTier");
      await session.setFeature?.("fast_mode", false);
      await session.startTurn("关闭后继续");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({ serviceTier: "default" });
      expect(appServer.requests().filter((request) => request.method === "thread/start")).toEqual(
        [],
      );
    } finally {
      await session.close();
    }
  });

  test("恢复时会话级关闭偏好优先于原生 Fast", async () => {
    const { session, appServer } = await createConnectedSession(
      { featureValues: { fast_mode: false } },
      {
        resumeHandle: { sessionId: "native-thread" },
        handlers: { "thread/resume": () => ({ serviceTier: "default" }) },
      },
    );
    try {
      await expect(appServer.waitForRequest("thread/resume")).resolves.toMatchObject({
        serviceTier: "default",
      });
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: false }),
      );
    } finally {
      await session.close();
    }
  });

  test("目录未声明档位时不因 GPT-5 名称猜测 Fast 可用", async () => {
    const { session } = await createConnectedSession(
      {},
      { handlers: { "model/list": () => ({ data: [{ id: "gpt-5.4", serviceTiers: [] }] }) } },
    );
    try {
      expect(session.features).toEqual([
        expect.objectContaining({ id: "plan_mode", value: false }),
      ]);
      await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow("not available");
    } finally {
      await session.close();
    }
  });

  test("原生响应返回模型实际标识后仍能识别目录中的 Fast 能力", async () => {
    const { session } = await createConnectedSession(
      { model: "codex-default", featureValues: { fast_mode: true } },
      {
        handlers: {
          "model/list": () => ({
            data: [{ ...FAST_MODEL, id: "codex-default", model: FAST_MODEL.id }],
          }),
          "thread/start": () => ({
            thread: { id: "thread-1" },
            model: FAST_MODEL.id,
            serviceTier: "priority",
          }),
        },
      },
    );
    try {
      await expect(session.getRuntimeInfo()).resolves.toMatchObject({ model: FAST_MODEL.id });
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
    } finally {
      await session.close();
    }
  });

  test("模型目录中的 fast 别名与原生返回的 priority 保持同一开关状态", async () => {
    const { session } = await createConnectedSession(
      { model: FAST_MODEL.id },
      {
        handlers: {
          "model/list": () => ({
            data: [{ ...FAST_MODEL, serviceTiers: [{ id: "fast", name: "Fast" }] }],
          }),
          "thread/start": () => ({ thread: { id: "thread-1" }, serviceTier: "priority" }),
        },
      },
    );
    try {
      await session.setFeature?.("fast_mode", true);
      await session.getRuntimeInfo();
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
    } finally {
      await session.close();
    }
  });

  test("自定义模型使用目录给出的 Fast 档位标识", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: "custom-model" },
      {
        handlers: {
          "model/list": () => ({
            data: [{ id: "custom-model", serviceTiers: [{ id: "custom-priority", name: "Fast" }] }],
          }),
        },
      },
    );
    try {
      await session.setFeature?.("fast_mode", true);
      await session.startTurn("使用目录能力");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        serviceTier: "custom-priority",
      });
    } finally {
      await session.close();
    }
  });

  test("原生配置关闭 Fast 功能时不提供无效开关", async () => {
    const { session } = await createConnectedSession(
      {},
      { handlers: { "config/read": () => ({ config: { features: { fast_mode: false } } }) } },
    );
    try {
      expect(session.features).toEqual([
        expect.objectContaining({ id: "plan_mode", value: false }),
      ]);
      await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow("not available");
    } finally {
      await session.close();
    }
  });

  test("会话额外配置中的 Fast 功能开关覆盖全局配置", async () => {
    const { session } = await createConnectedSession(
      { extra: { codex: { features: { fast_mode: false } } } },
      { handlers: { "config/read": () => ({ config: { features: { fast_mode: true } } }) } },
    );
    try {
      expect(session.features).toEqual([
        expect.objectContaining({ id: "plan_mode", value: false }),
      ]);
    } finally {
      await session.close();
    }
  });

  test("切换到支持 Fast 的新模型保留原生线程的当前选择", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      {
        resumeHandle: { sessionId: "native-thread" },
        handlers: {
          "thread/resume": () => ({ serviceTier: "priority" }),
          "model/list": () => ({ data: [{ ...FAST_MODEL, id: "gpt-5.4" }, FAST_MODEL] }),
        },
      },
    );
    try {
      await session.setModel(FAST_MODEL.id);
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
      await session.startTurn("新模型");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model: FAST_MODEL.id,
        serviceTier: "priority",
      });
    } finally {
      await session.close();
    }
  });

  test("读取模型全部分页并保留档位能力，不重复查询配置", async () => {
    const appServer = createFakeCodexAppServer({
      "model/list": (params) => {
        const parsed = z.object({ cursor: z.string().optional() }).parse(params);
        if (parsed.cursor === undefined)
          return { data: [{ id: "other-model" }], nextCursor: "next-page" };
        expect(parsed.cursor).toBe("next-page");
        return { data: [FAST_MODEL], nextCursor: null };
      },
    });
    const provider = new CodexAppServerAgentClient(createTestLogger(), undefined, {
      spawnAppServer: async () => appServer.child,
      resolveCodexVersion: async () => "0.0.0",
    });
    const catalog = await provider.fetchCatalog({ scope: "global", force: false });
    expect(catalog.models.map((model) => model.id)).toEqual(["other-model", FAST_MODEL.id]);
    expect(catalog.models[1].metadata).toMatchObject({ serviceTiers: FAST_MODEL.serviceTiers });
    expect(appServer.requests().filter((request) => request.method === "config/read")).toHaveLength(
      1,
    );
    appServer.assertNoErrors();
  });

  test("切换到不支持的模型后再切回，已保存 Fast 偏好与界面保持一致", async () => {
    const { session } = await createConnectedSession({ featureValues: { fast_mode: true } });
    try {
      await session.setModel("gpt-3.5-turbo");
      expect(session.features).toEqual([
        expect.objectContaining({ id: "plan_mode", value: false }),
      ]);
      await session.setModel("gpt-5.4");
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: true }),
      );
    } finally {
      await session.close();
    }
  });

  test("草稿功能只读取目录，不创建线程或初始化桌面工具", async () => {
    const appServer = createFakeCodexAppServer({
      "model/list": () => ({ data: [FAST_MODEL] }),
      "config/read": () => ({ config: { service_tier: "fast" } }),
    });
    const provider = new CodexAppServerAgentClient(createTestLogger(), undefined, {
      spawnAppServer: async () => appServer.child,
    });
    await expect(provider.listFeatures(createConfig({ model: undefined }))).resolves.toEqual([]);
    expect(appServer.requests()).toEqual([]);
    await expect(
      provider.listFeatures(createConfig({ model: FAST_MODEL.id })),
    ).resolves.toContainEqual(expect.objectContaining({ id: "fast_mode", value: true }));
    expect(appServer.requests().map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "model/list",
      "config/read",
    ]);
    appServer.assertNoErrors();
  });

  test("配置与模型目录并行读取，目录不必等配置响应才能发起", async () => {
    const configRead = Promise.withResolvers<void>();
    const { session } = await createConnectedSession(
      { model: FAST_MODEL.id },
      {
        handlers: {
          "model/list": async () => {
            await configRead.promise;
            return { data: [FAST_MODEL] };
          },
          "config/read": () => {
            configRead.resolve();
            return { config: {} };
          },
        },
      },
    );
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({ id: "fast_mode", value: false }),
      );
    } finally {
      await session.close();
    }
  });

  test("原生目录或配置非法时明确失败，不把解析错误当作不支持 Fast", async () => {
    const { session } = createSessionHarness(
      {},
      {
        handlers: { "model/list": () => ({ data: [{ id: "gpt-5.4", serviceTiers: "invalid" }] }) },
      },
    );
    await expect(session.connect()).rejects.toThrow("serviceTiers");
  });

  test("features returns fast and plan toggles when supported", async () => {
    const { session } = await createConnectedSession();

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "使用当前模型支持的快速处理档位",
        tooltip: "切换快速模式",
        icon: "zap",
        value: false,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);

    await session.setFeature?.("fast_mode", true);
    await session.setFeature?.("plan_mode", true);

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "使用当前模型支持的快速处理档位",
        tooltip: "切换快速模式",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
    ]);
  });

  test("features returns only plan toggle when model does not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);
  });

  test("constructor ignores restored fast mode when model does not support it", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-3.5-turbo",
      featureValues: { fast_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("setFeature('fast_mode', true) sets serviceTier to fast", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
    });
  });

  test("关闭 Fast 明确发送标准档位，不继续继承线程设置", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true },
    });

    await session.setFeature?.("fast_mode", false);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("setFeature('fast_mode', true) rejects models that do not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
      "Codex fast mode is not available for model 'gpt-3.5-turbo'",
    );
  });

  test("setFeature invalidates runtime info", async () => {
    const { session } = await createConnectedSession();

    await expect(session.getRuntimeInfo()).resolves.not.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });

    await session.setFeature?.("plan_mode", true);

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });
  });

  test("setFeature throws for unknown feature ids", async () => {
    const { session } = createSessionHarness();

    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(
      "Unknown Codex feature: unknown_feature",
    );
  });

  test("constructor restores feature flags from config.featureValues", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true, plan_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "使用当前模型支持的快速处理档位",
        tooltip: "切换快速模式",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });

  test("startTurn includes serviceTier when fast mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "priority",
    });
  });

  test("startTurn logs a sanitized turn/start summary for fast mode observability", async () => {
    const capture = createCapturedLogger();
    const prompt = "secret prompt text should not be logged";
    const { session } = await createConnectedSession(
      { featureValues: { fast_mode: true } },
      { logger: capture.logger },
    );

    await session.startTurn(prompt);

    const entry = capture.entries.find(
      (candidate) => candidate.msg === "Starting Codex app-server turn",
    );
    expect(entry).toMatchObject({
      level: 30,
      msg: "Starting Codex app-server turn",
      model: "gpt-5.4",
      modeId: "auto",
      serviceTier: "priority",
      cwd: "/tmp/codex-fast-mode-test",
    });
    expect(JSON.stringify(entry)).not.toContain(prompt);
  });

  test("setModel clears fast mode when switching to an unsupported model", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.setModel("gpt-3.5-turbo");

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "default",
    });
  });

  test("startTurn switches collaboration mode when plan mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("plan_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });
});
