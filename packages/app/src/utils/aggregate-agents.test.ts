import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { collectAggregatedAgents } from "./aggregate-agents";

const AGENT_TIME = new Date("2026-07-25T12:00:00.000Z");

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  const { id, ...overrides } = input;
  return {
    serverId: "server-a",
    id,
    provider: "codex",
    status: "idle",
    createdAt: AGENT_TIME,
    updatedAt: AGENT_TIME,
    lastUserMessageAt: null,
    lastActivityAt: AGENT_TIME,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: input.id,
    cwd: "E:\\paseo",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    ...overrides,
  };
}

function collect(sessionAgents: Record<string, Map<string, Agent>>) {
  return collectAggregatedAgents({
    sessionAgents,
    serverLabelById: new Map([["server-a", "本机"]]),
    includeArchived: false,
    previousById: new Map(),
  });
}

describe("collectAggregatedAgents", () => {
  it("同一主机上的 Codex 原生会话只保留最近记录", () => {
    const older = makeAgent({
      id: "older",
      lastActivityAt: new Date("2026-07-25T11:00:00.000Z"),
      persistence: {
        provider: "codex",
        sessionId: "thread-1",
        nativeHandle: "thread-1",
      },
    });
    const newer = makeAgent({
      id: "newer",
      lastActivityAt: new Date("2026-07-25T12:00:00.000Z"),
      runtimeInfo: { provider: "codex", sessionId: "thread-1" },
    });

    expect(
      collect({
        "server-a": new Map([
          [older.id, older],
          [newer.id, newer],
        ]),
      }),
    ).toEqual([expect.objectContaining({ id: "newer" })]);
  });

  it("不同主机或非 Codex 会话不会互相去重", () => {
    const first = makeAgent({
      id: "first",
      persistence: { provider: "codex", sessionId: "shared", nativeHandle: "shared" },
    });
    const second = makeAgent({
      id: "second",
      serverId: "server-b",
      persistence: { provider: "codex", sessionId: "shared", nativeHandle: "shared" },
    });
    const claude = makeAgent({
      id: "claude",
      provider: "claude",
      persistence: { provider: "claude", sessionId: "shared", nativeHandle: "shared" },
    });

    const result = collect({
      "server-a": new Map([
        [first.id, first],
        [claude.id, claude],
      ]),
      "server-b": new Map([[second.id, second]]),
    });

    expect(result.map((agent) => agent.id)).toEqual(["first", "claude", "second"]);
  });
});
