import { beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";

const mockState = vi.hoisted(() => ({
  superConstructorOptions: [] as unknown[],
  deletedGrokSessions: [] as unknown[],
}));

vi.mock("./acp-agent.js", () => ({
  DEFAULT_ACP_CAPABILITIES: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
    supportsRewindConversation: false,
    supportsRewindFiles: false,
    supportsRewindBoth: false,
  },
  ACPAgentClient: class ACPAgentClient {
    readonly provider: string;

    constructor(options: unknown) {
      this.provider = "acp";
      mockState.superConstructorOptions.push(options);
    }
  },
}));

vi.mock("./grok-native-session.js", () => ({
  deleteGrokNativeSession: vi.fn(async (options: unknown) => {
    mockState.deletedGrokSessions.push(options);
  }),
}));

import { GenericACPAgentClient } from "./generic-acp-agent.js";

describe("GenericACPAgentClient", () => {
  beforeEach(() => {
    mockState.superConstructorOptions.length = 0;
    mockState.deletedGrokSessions.length = 0;
  });

  test("passes the custom command only as defaultCommand", () => {
    const _client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: ["hermes", "acp"],
      env: {
        HERMES_LOG: "info",
      },
    });
    void _client;

    expect(mockState.superConstructorOptions).toEqual([
      {
        provider: "acp",
        logger: expect.any(Object),
        runtimeSettings: {
          env: {
            HERMES_LOG: "info",
          },
        },
        defaultCommand: ["hermes", "acp"],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
          supportsRewindConversation: false,
          supportsRewindFiles: false,
          supportsRewindBoth: false,
        },
      },
    ]);
  });

  test("uses provider params to report MCP support", () => {
    const _client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: ["no-mcp-acp", "serve"],
      providerParams: {
        supportsMcpServers: false,
      },
    });
    void _client;

    expect(mockState.superConstructorOptions.at(-1)).toMatchObject({
      capabilities: {
        supportsMcpServers: false,
      },
    });
  });

  test("Grok Provider 使用同一启动配置清理原生会话", async () => {
    const _client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: ["custom-grok", "agent", "stdio"],
      env: { GROK_CONFIG: "isolated" },
      providerId: "grok",
    });
    void _client;

    const options = mockState.superConstructorOptions.at(-1) as {
      cleanupNativeSession: (sessionId: string) => Promise<void>;
    };
    await options.cleanupNativeSession("session-1");

    expect(mockState.deletedGrokSessions).toEqual([
      {
        command: ["custom-grok", "agent", "stdio"],
        env: { GROK_CONFIG: "isolated" },
        sessionId: "session-1",
      },
    ]);
  });

  test("其他 ACP Provider 不注入 Grok 原生删除", () => {
    const _client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: ["hermes", "acp"],
      providerId: "hermes",
    });
    void _client;

    expect(mockState.superConstructorOptions.at(-1)).not.toHaveProperty("cleanupNativeSession");
  });
});
