import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentSideConnection,
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type SessionConfigOption,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
import {
  AGY_ALLOW_ALL_MODE_ID,
  AgyACPAgentClient,
  buildAgyNewSessionMeta,
  findDefaultAgyBinary,
  normalizeAgyPath,
  transformAgySessionResponse,
  transformAgyToolSnapshot,
} from "./agy-acp-agent.js";
import type { SpawnedACPProcess } from "./acp-agent.js";

const tempDirs: string[] = [];
const originalEnv = {
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  PATH: process.env.PATH,
  PATHEXT: process.env.PATHEXT,
};

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalEnv.LOCALAPPDATA === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = originalEnv.LOCALAPPDATA;
  }
  process.env.PATH = originalEnv.PATH;
  process.env.PATHEXT = originalEnv.PATHEXT;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function agyConfigOptions(
  currentModel: string,
  thoughtLevel: string | null = "medium",
  mode = "default",
): SessionConfigOption[] {
  const options: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: currentModel,
      options: [
        { value: "gemini-4-argon", name: "Gemini 4 Argon" },
        { value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
        { value: "gemini-pro-orchestrator-g1-pro", name: "Orchestrator (Argon)" },
      ],
    },
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: mode,
      options: [
        { value: "default", name: "Default" },
        { value: "accept-edits", name: "Accept edits" },
        { value: "auto", name: "Auto" },
        { value: "plan", name: "Plan" },
      ],
    },
  ];

  if (thoughtLevel !== null) {
    options.splice(1, 0, {
      id: "thought_level",
      name: "Thinking Level",
      category: "thought_level",
      type: "select",
      currentValue: thoughtLevel,
      options:
        currentModel === "gemini-4-hydrogen"
          ? [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
              { value: "xhigh", name: "Extra" },
            ]
          : [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
            ],
    });
  }

  return options;
}

function createInMemoryAgyPair(agentImpl: (client: AgentSideConnection) => Agent) {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();

  const agentStream = ndJsonStream(clientToAgent.writable, agentToClient.readable);
  const clientStream = ndJsonStream(agentToClient.writable, clientToAgent.readable);

  const agentConnection = new AgentSideConnection(agentImpl, agentStream);
  return { agentConnection, clientStream };
}

describe("AgyACPAgentClient path and metadata normalization", () => {
  test("normalizes Windows URI-style drive paths without altering POSIX paths", () => {
    expect(normalizeAgyPath("/C:/Users/alice/repo")).toBe("C:\\Users\\alice\\repo");
    expect(normalizeAgyPath("/e%3A/paseo")).toBe("e:\\paseo");
    expect(normalizeAgyPath("/e%3A/chat/%E6%96%B0%E5%BB%BA%E6%96%87%E4%BB%B6%E5%A4%B9")).toBe(
      "e:\\chat\\新建文件夹",
    );
    expect(normalizeAgyPath("file:///D:/work/app")).toBe("D:\\work\\app");
    expect(normalizeAgyPath("E:\\paseo")).toBe("E:\\paseo");
    expect(normalizeAgyPath("/Users/alice/repo")).toBe("/Users/alice/repo");
    expect(normalizeAgyPath("/tmp/paseo-test")).toBe("/tmp/paseo-test");
  });

  test("transforms Antigravity PascalCase rawInput, snake_case exit_code, and Windows URI locations", () => {
    expect(
      transformAgyToolSnapshot({
        toolCallId: "call-1",
        title: "File /C:/repo/src/index.ts",
        kind: "read",
        status: "completed",
        locations: [{ path: "/C:/repo/src/index.ts" }],
        rawInput: { Path: "C:\\repo\\src\\index.ts" },
      }),
    ).toMatchObject({
      title: "File C:\\repo\\src\\index.ts",
      locations: [{ path: "C:\\repo\\src\\index.ts" }],
      rawInput: { Path: "C:\\repo\\src\\index.ts", path: "C:\\repo\\src\\index.ts" },
    });

    expect(
      transformAgyToolSnapshot({
        toolCallId: "call-2",
        title: "npm test",
        kind: "execute",
        status: "failed",
        rawInput: { CommandLine: "npm test", Cwd: "/e%3A/paseo" },
        rawOutput: { output: "boom", exit_code: 2 },
      }),
    ).toMatchObject({
      rawInput: {
        CommandLine: "npm test",
        command: "npm test",
        Cwd: "/e%3A/paseo",
        cwd: "e:\\paseo",
      },
      rawOutput: { output: "boom", exit_code: 2, exitCode: 2 },
    });
  });

  test("composes systemPrompt and daemonAppendSystemPrompt into _meta.antigravity.systemPrompt.append", () => {
    expect(
      buildAgyNewSessionMeta({
        provider: "agy",
        cwd: "/tmp/repo",
        systemPrompt: "Project instructions.",
        daemonAppendSystemPrompt: "Daemon instructions.",
      }),
    ).toEqual({
      antigravity: {
        systemPrompt: {
          append: "Project instructions.\n\nDaemon instructions.",
        },
      },
    });
    expect(buildAgyNewSessionMeta({ provider: "agy", cwd: "/tmp/repo" })).toBeUndefined();
  });

  test("strips legacy flattened models when configOptions exposes model selection and appends allow-all mode", () => {
    const transformed = transformAgySessionResponse({
      sessionId: "sess-1",
      models: {
        currentModelId: "gemini-4-argon-medium",
        availableModels: [{ modelId: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" }],
      },
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "auto", name: "Auto" },
        ],
      },
      configOptions: agyConfigOptions("gemini-4-argon"),
    });

    expect(transformed.models).toBeUndefined();
    expect(transformed.modes?.availableModes?.map((mode) => mode.id)).toEqual([
      "default",
      "auto",
      AGY_ALLOW_ALL_MODE_ID,
    ]);
  });
});

describe("AgyACPAgentClient catalog, session lifecycle, and permissions", () => {
  test("discovers base models and per-model thought_level options including xhigh and models without thinking levels", async () => {
    class TestAgyClient extends AgyACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "sess-1",
              models: {
                currentModelId: "gemini-pro-orchestrator-g1-pro",
                availableModels: [
                  { modelId: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
                  { modelId: "gemini-4-hydrogen-xhigh", name: "Gemini 4 Hydrogen (XHigh)" },
                ],
              },
              modes: {
                currentModeId: "default",
                availableModes: [
                  { id: "default", name: "Default" },
                  { id: "auto", name: "Auto" },
                  { id: "plan", name: "Plan" },
                ],
              },
              configOptions: agyConfigOptions("gemini-pro-orchestrator-g1-pro", null),
            }),
            setSessionConfigOption: vi.fn(async ({ value }: { value: string }) => ({
              configOptions:
                value === "gemini-pro-orchestrator-g1-pro"
                  ? agyConfigOptions(value, null)
                  : agyConfigOptions(value, "medium"),
            })),
          },
          initialize: { agentCapabilities: {} },
        } as unknown as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestAgyClient({ logger: createTestLogger() });
    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/agy-catalog",
      force: false,
    });

    expect(catalog.models.map((model) => model.id)).toEqual([
      "gemini-4-argon",
      "gemini-4-hydrogen",
      "gemini-pro-orchestrator-g1-pro",
    ]);
    expect(
      catalog.models
        .find((model) => model.id === "gemini-4-argon")
        ?.thinkingOptions?.map((o) => o.id),
    ).toEqual(["low", "medium", "high"]);
    expect(
      catalog.models
        .find((model) => model.id === "gemini-4-hydrogen")
        ?.thinkingOptions?.map((o) => o.id),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(
      catalog.models.find((model) => model.id === "gemini-pro-orchestrator-g1-pro")
        ?.thinkingOptions,
    ).toBeUndefined();
    expect(catalog.modes.map((mode) => mode.id)).toEqual([
      "default",
      "auto",
      "plan",
      AGY_ALLOW_ALL_MODE_ID,
    ]);
  });

  test("normalizes listImportableSessions cwd and filters accurately even when agent returns other workspaces", async () => {
    class TestAgyListClient extends AgyACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            listSessions: vi.fn().mockResolvedValue({
              sessions: [
                {
                  sessionId: "other-1",
                  cwd: "/C:/other/project",
                  title: "Other",
                  updatedAt: "2026-11-16T10:00:00Z",
                },
                {
                  sessionId: "match-1",
                  cwd: "/e%3A/paseo",
                  title: "Target URI",
                  updatedAt: "2026-11-16T11:00:00Z",
                },
                {
                  sessionId: "match-2",
                  cwd: "E:\\paseo",
                  title: "Target Win",
                  updatedAt: "2026-11-16T12:00:00Z",
                },
              ],
              nextCursor: null,
            }),
          },
          initialize: {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: { sessionCapabilities: { list: {} } },
          },
        } as unknown as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestAgyListClient({ logger: createTestLogger() });
    const sessions = await client.listImportableSessions({ cwd: "E:\\paseo", limit: 1 });
    expect(sessions).toEqual([
      expect.objectContaining({
        providerHandleId: "match-1",
        cwd: "e:\\paseo",
        title: "Target URI",
      }),
    ]);

    const allInWorkspace = await client.listImportableSessions({ cwd: "E:\\paseo" });
    expect(allInWorkspace.map((entry) => [entry.providerHandleId, entry.cwd])).toEqual([
      ["match-1", "e:\\paseo"],
      ["match-2", "E:\\paseo"],
    ]);
  });

  test("supports allow-all auto-approval and switching back to interactive permission prompts", async () => {
    let activeMode = "default";
    let receivedNewSessionMeta: unknown;
    let promptCalls = 0;

    const { agentConnection, clientStream } = createInMemoryAgyPair((conn) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { close: {} },
          },
        };
      },
      async authenticate() {
        return {};
      },
      async unstable_closeSession() {
        return {};
      },
      async newSession(params) {
        receivedNewSessionMeta = params._meta;
        return {
          sessionId: "agy-sess-1",
          modes: {
            currentModeId: activeMode,
            availableModes: [
              { id: "default", name: "Default" },
              { id: "auto", name: "Auto" },
              { id: "plan", name: "Plan" },
            ],
          },
          configOptions: agyConfigOptions("gemini-4-argon", "medium", activeMode),
        };
      },
      async setSessionMode(params) {
        activeMode = params.modeId;
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "current_mode_update", currentModeId: activeMode },
        });
        return {};
      },
      async setSessionConfigOption(params) {
        if (params.configId === "model") {
          return {
            configOptions:
              params.value === "gemini-pro-orchestrator-g1-pro"
                ? agyConfigOptions(params.value, null, activeMode)
                : agyConfigOptions(params.value, "medium", activeMode),
          };
        }
        return { configOptions: agyConfigOptions("gemini-4-argon", "medium", activeMode) };
      },
      async prompt(params) {
        promptCalls += 1;
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            size: 1_048_576,
            used: 4096 * promptCalls,
          },
        });
        const permResponse = await conn.requestPermission({
          sessionId: params.sessionId,
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
          toolCall: {
            toolCallId: `call-${promptCalls}`,
            title: "echo ok",
            kind: "execute",
            rawInput: { CommandLine: "echo ok" },
          },
        });
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text:
                permResponse.outcome.outcome === "selected"
                  ? `selected:${permResponse.outcome.optionId}`
                  : "cancelled",
            },
          },
        });
        return {
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        };
      },
    }));

    class InMemoryAgyClient extends AgyACPAgentClient {
      protected override createSessionInstance(
        config: Parameters<AgyACPAgentClient["createSessionInstance"]>[0],
        options: Parameters<AgyACPAgentClient["createSessionInstance"]>[1],
      ) {
        const session = super.createSessionInstance(config, {
          ...options,
          terminateProcess: async () => undefined,
        });
        const clientConnection = new ClientSideConnection(() => session, clientStream);
        // Bypass child spawning and drive the session directly over the in-memory ACP stream.
        Reflect.set(session, "spawnProcess", async () => ({
          child: {
            kill: vi.fn(),
            exitCode: 0,
            signalCode: null,
            once: vi.fn(),
            stdin: { destroy: vi.fn() },
            stdout: { destroy: vi.fn() },
            stderr: { destroy: vi.fn() },
          },
          connection: clientConnection,
          initialize: await clientConnection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: true,
            },
          }),
        }));
        return session;
      }
    }

    const client = new InMemoryAgyClient({ logger: createTestLogger() });
    const session = await client.createSession({
      provider: "agy",
      cwd: "/tmp/agy-test",
      modeId: AGY_ALLOW_ALL_MODE_ID,
      systemPrompt: "Follow Paseo rules.",
    });

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    expect(receivedNewSessionMeta).toEqual({
      antigravity: { systemPrompt: { append: "Follow Paseo rules." } },
    });
    expect(await session.getCurrentMode()).toBe(AGY_ALLOW_ALL_MODE_ID);
    expect(activeMode).toBe("default");

    const firstTurn = await session.run("run tool");
    expect(firstTurn.finalText).toBe("selected:allow");
    expect(firstTurn.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      contextWindowMaxTokens: 1_048_576,
      contextWindowUsedTokens: 4096,
    });
    expect(events.some((event) => event.type === "permission_requested")).toBe(false);

    // Switching to a model without thought_level clears stale thinkingOptionId cleanly.
    await session.setModel?.("gemini-pro-orchestrator-g1-pro");
    expect((await session.getRuntimeInfo()).thinkingOptionId).toBeNull();

    // Switching back from allow-all to default restores interactive permission prompts.
    await session.setMode("default");
    expect(await session.getCurrentMode()).toBe("default");

    const permissionPromise = new Promise<string>((resolve) => {
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "permission_requested") {
          unsubscribe();
          void session.respondToPermission(event.request.id, { behavior: "deny" });
          resolve(event.request.id);
        }
      });
    });

    const secondTurn = await session.run("run tool again");
    await permissionPromise;
    expect(secondTurn.finalText).toBe("selected:deny");
    expect(await session.getUsage?.()).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      contextWindowMaxTokens: 1_048_576,
      contextWindowUsedTokens: 8192,
    });

    await session.close();
    void agentConnection;
  });

  test("discovers Windows %LOCALAPPDATA%\\agy\\bin\\agy.exe when PATH omits agy", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = makeTempDir("agy-localappdata-");
    const emptyPath = path.join(root, "empty-path");
    const agyBinDir = path.join(root, "agy", "bin");
    const agyExe = path.join(agyBinDir, "agy.exe");
    mkdirSync(emptyPath, { recursive: true });
    mkdirSync(agyBinDir, { recursive: true });
    copyFileSync(process.execPath, agyExe);

    process.env.LOCALAPPDATA = root;
    process.env.PATH = emptyPath;
    process.env.PATHEXT = ".EXE";

    const client = new AgyACPAgentClient({ logger: createTestLogger() });
    await expect(findDefaultAgyBinary()).resolves.toBe(agyExe);
    await expect(client.isAvailable()).resolves.toBe(true);
  });

  test("reports unavailable when agy binary is missing", async () => {
    const emptyDir = makeTempDir("agy-missing-");
    process.env.PATH = emptyDir;
    if (process.platform === "win32") {
      process.env.LOCALAPPDATA = emptyDir;
      process.env.PATHEXT = ".EXE";
    }

    const client = new AgyACPAgentClient({ logger: createTestLogger() });
    await expect(client.isAvailable()).resolves.toBe(false);
  });
});
