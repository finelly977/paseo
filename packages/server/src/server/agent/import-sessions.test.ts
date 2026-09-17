import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import type { FetchRecentProviderSessionsRequestMessage } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { createPersistedWorkspaceRecord } from "../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  type ImportSessionAgentManager,
  ImportSessionsRequestError,
  importProviderSession,
  listImportableProviderSessions,
  normalizeImportAgentRequest,
} from "./import-sessions.js";

const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";
const importTestDirectories: string[] = [];

const TEST_CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const directory of importTestDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeImportableSession(args: {
  provider?: string;
  sessionId: string;
  nativeHandle?: string;
  cwd?: string;
  title?: string | null;
  lastActivityAt: string;
  firstPrompt?: string;
  lastPrompt?: string;
}): ManagedImportableProviderSession {
  const provider = args.provider ?? "codex";
  const cwd = args.cwd ?? "/tmp/project";
  return {
    provider,
    providerHandleId: args.nativeHandle ?? args.sessionId,
    cwd,
    title: args.title ?? null,
    lastActivityAt: new Date(args.lastActivityAt),
    firstPromptPreview: args.firstPrompt ?? null,
    lastPromptPreview: args.lastPrompt ?? args.firstPrompt ?? null,
  };
}

function makeManagedAgent(args: {
  id?: string;
  provider?: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  title?: string | null;
}): ManagedAgent {
  const provider = args.provider ?? "codex";
  return {
    id: args.id ?? "00000000-0000-4000-8000-000000000632",
    provider,
    cwd: args.cwd,
    capabilities: TEST_CAPABILITIES,
    config: { provider, cwd: args.cwd, title: args.title },
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: {
      provider,
      sessionId: args.sessionId,
      ...(args.nativeHandle ? { nativeHandle: args.nativeHandle } : {}),
      metadata: { provider, cwd: args.cwd },
    },
    historyPrimed: true,
    lastUserMessageAt: null,
    attention: { requiresAttention: false },
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    internal: false,
    labels: {},
    lifecycle: "closed",
    session: null,
    activeForegroundTurnId: null,
  } satisfies ManagedAgent;
}

function createImportWorkspace(
  workspaceId: string,
): Pick<WorkspaceProvisioningService, "runInImportWorkspace"> {
  return {
    async runInImportWorkspace(input, operation) {
      const workspace = createPersistedWorkspaceRecord({
        workspaceId,
        projectId: `project-${workspaceId}`,
        cwd: input.cwd,
        kind: "directory",
        displayName: "imported",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      });
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    },
  };
}

function makeRequest(
  overrides: Partial<FetchRecentProviderSessionsRequestMessage> = {},
): FetchRecentProviderSessionsRequestMessage {
  return {
    type: "fetch_recent_provider_sessions_request",
    requestId: "recent-provider-sessions",
    ...overrides,
  };
}

test("listImportableProviderSessions filters, sorts, limits, and projects importable sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "outside-cwd",
      nativeHandle: "outside-cwd-handle",
      cwd: "/tmp/elsewhere",
      title: "Outside cwd",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
    }),
    makeImportableSession({
      sessionId: "stored-session",
      nativeHandle: "stored-handle",
      cwd,
      title: "Already stored",
      lastActivityAt: "2026-04-30T12:04:00.000Z",
      firstPrompt: "stored prompt",
    }),
    makeImportableSession({
      sessionId: "older-session",
      nativeHandle: "older-handle",
      cwd,
      title: "Older than since",
      lastActivityAt: "2026-04-29T23:59:59.000Z",
    }),
    makeImportableSession({
      sessionId: "newer-session",
      nativeHandle: "newer-handle",
      cwd,
      title: "Newer import",
      lastActivityAt: "2026-04-30T12:02:00.000Z",
      firstPrompt: "newer first prompt",
      lastPrompt: "newer last prompt",
    }),
    makeImportableSession({
      sessionId: "second-session",
      nativeHandle: "second-handle",
      cwd,
      title: "Second import",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "second prompt",
    }),
    makeImportableSession({
      sessionId: "third-session",
      nativeHandle: "third-handle",
      cwd,
      title: "Third import",
      lastActivityAt: "2026-04-30T11:59:00.000Z",
      firstPrompt: "third prompt",
    }),
    makeImportableSession({
      sessionId: "live-session",
      nativeHandle: "live-handle",
      cwd,
      title: "Already live",
      lastActivityAt: "2026-04-30T12:01:00.000Z",
      firstPrompt: "live prompt",
    }),
  ];
  const listImportableSessions = vi.fn(async () => sessions);
  const agentManager = {
    listAgents: () =>
      [
        {
          provider: "codex",
          persistence: {
            provider: "codex",
            sessionId: "live-session",
            nativeHandle: "live-handle",
          },
        },
      ] as ManagedAgent[],
    listImportableSessions,
  } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">;
  const agentStorage = {
    list: async () => [
      {
        provider: "codex",
        cwd,
        persistence: {
          provider: "codex",
          sessionId: "stored-session",
          nativeHandle: "stored-handle",
        },
      } as StoredAgentRecord,
    ],
  } satisfies Pick<AgentStorage, "list">;

  const result = await listImportableProviderSessions({
    request: makeRequest({
      cwd,
      providers: ["codex"],
      since: "2026-04-30T00:00:00.000Z",
      limit: 2,
    }),
    agentManager,
    agentStorage,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 4,
    providerFilter: new Set(["codex"]),
    cwd,
  });
  expect(result).toEqual({
    filteredAlreadyImportedCount: 2,
    titleRepairs: [],
    entries: [
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "newer-handle",
        cwd,
        title: "Newer import",
        firstPromptPreview: "newer first prompt",
        lastPromptPreview: "newer last prompt",
        lastActivityAt: "2026-04-30T12:02:00.000Z",
      },
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "second-handle",
        cwd,
        title: "Second import",
        firstPromptPreview: "second prompt",
        lastPromptPreview: "second prompt",
        lastActivityAt: "2026-04-30T12:00:00.000Z",
      },
    ],
  });
});

test("listImportableProviderSessions 按提供方原生会话 ID 去重", async () => {
  const result = await listImportableProviderSessions({
    request: makeRequest({ providers: ["codex"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [
        makeImportableSession({
          sessionId: "codex-row-1",
          nativeHandle: "same-thread",
          title: "旧条目",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
        }),
        makeImportableSession({
          sessionId: "codex-row-2",
          nativeHandle: "same-thread",
          title: "最新条目",
          lastActivityAt: "2026-04-30T12:05:00.000Z",
        }),
      ],
    },
    agentStorage: { list: async () => [] },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]?.providerHandleId).toBe("same-thread");
  expect(result.entries[0]?.title).toBe("最新条目");
});

test("listImportableProviderSessions 使用旧记录的运行时会话 ID 防重并补足限制数量", async () => {
  const listImportableSessions = vi.fn(async () => [
    makeImportableSession({
      sessionId: "already-imported",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
    }),
    makeImportableSession({
      sessionId: "available",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ]);
  const result = await listImportableProviderSessions({
    request: makeRequest({ providers: ["codex"], limit: 1 }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions,
    },
    agentStorage: {
      list: async () => [
        {
          id: "legacy-agent",
          provider: "codex",
          cwd: "/tmp/project",
          persistence: null,
          runtimeInfo: { provider: "codex", sessionId: "already-imported" },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 2,
    providerFilter: new Set(["codex"]),
    cwd: undefined,
  });
  expect(result.filteredAlreadyImportedCount).toBe(1);
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["available"]);
});

test("listImportableProviderSessions 为旧导入记录生成 CLI 标题修复", async () => {
  const cwd = "/tmp/project";
  const agentId = "00000000-0000-4000-8000-000000000634";
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [
        makeImportableSession({
          sessionId: "imported-session",
          cwd,
          title: "Codex CLI 真实标题",
          firstPrompt: "首条用户消息",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
        }),
      ],
    },
    agentStorage: {
      list: async () => [
        makeStoredProviderSession({
          id: agentId,
          cwd,
          sessionId: "imported-session",
          workspaceId: "ws-imported-title",
          title: "首条用户消息",
          archivedAt: null,
        }),
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toEqual([]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
  expect(result.titleRepairs).toEqual([
    {
      agentId,
      workspaceId: "ws-imported-title",
      title: "Codex CLI 真实标题",
      updateAgentTitle: true,
    },
  ]);
});

test("listImportableProviderSessions 保留手动修改过的会话标题", async () => {
  const cwd = "/tmp/project";
  const agentId = "00000000-0000-4000-8000-000000000636";
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [
        makeImportableSession({
          provider: "claude",
          sessionId: "manual-title-session",
          cwd,
          title: "Claude CLI 真实标题",
          firstPrompt: "首条用户消息",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
        }),
      ],
    },
    agentStorage: {
      list: async () => [
        {
          ...makeStoredProviderSession({
            id: agentId,
            cwd,
            sessionId: "manual-title-session",
            workspaceId: "ws-manual-title",
            title: "用户手动标题",
            archivedAt: null,
          }),
          provider: "claude",
          persistence: { provider: "claude", sessionId: "manual-title-session" },
        },
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.titleRepairs).toEqual([
    {
      agentId,
      workspaceId: "ws-manual-title",
      title: "Claude CLI 真实标题",
      updateAgentTitle: false,
    },
  ]);
});

test("listImportableProviderSessions 不用 CLI 子会话标题改写工作区名称", async () => {
  const cwd = "/tmp/project";
  const rootAgentId = "00000000-0000-4000-8000-000000000637";
  const childAgentId = "00000000-0000-4000-8000-000000000638";
  const workspaceId = "ws-imported-subagent-title";
  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [
        makeImportableSession({
          sessionId: "imported-child-session",
          cwd,
          title: "CLI 子会话标题",
          firstPrompt: "子会话首条消息",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
        }),
      ],
    },
    agentStorage: {
      list: async () => [
        makeStoredProviderSession({
          id: rootAgentId,
          cwd,
          sessionId: "workspace-root-session",
          workspaceId,
          archivedAt: null,
        }),
        makeStoredProviderSession({
          id: childAgentId,
          cwd,
          sessionId: "imported-child-session",
          workspaceId,
          title: "子会话首条消息",
          labels: { [PARENT_AGENT_ID_LABEL]: rootAgentId },
          archivedAt: null,
        }),
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.titleRepairs).toEqual([
    {
      agentId: childAgentId,
      title: "CLI 子会话标题",
      updateAgentTitle: true,
    },
  ]);
});

test("listImportableProviderSessions looks past already-imported rows to fill the requested limit", async () => {
  const cwd = "/tmp/project";
  const imported = makeImportableSession({
    provider: "claude",
    sessionId: "already-imported",
    cwd,
    lastActivityAt: "2026-04-30T12:02:00.000Z",
  });
  const available = makeImportableSession({
    provider: "claude",
    sessionId: "available",
    cwd,
    lastActivityAt: "2026-04-30T12:01:00.000Z",
  });
  const listImportableSessions = vi.fn(async (options?: { limit?: number }) =>
    [imported, available].slice(0, options?.limit),
  );

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"], limit: 1 }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions,
    },
    agentStorage: {
      list: async () => [
        {
          provider: "claude",
          cwd,
          persistence: { provider: "claude", sessionId: "already-imported" },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude Code" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 2,
    providerFilter: new Set(["claude"]),
    cwd,
  });
  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["available"]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test("listImportableProviderSessions includes a provider session after its Paseo agent is archived", async () => {
  const cwd = "/tmp/project";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-session",
    cwd,
    title: "Archived import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "import me again",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [archivedSession],
    },
    agentStorage: {
      list: async () => [
        {
          provider: "claude",
          archivedAt: "2026-04-30T12:01:00.000Z",
          persistence: {
            provider: "claude",
            sessionId: "archived-session",
          },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["archived-session"]);
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions includes an archived provider session still loaded in memory", async () => {
  const cwd = "/tmp/project";
  const agentId = "00000000-0000-4000-8000-000000000633";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-live-session",
    cwd,
    title: "Archived live import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "import the loaded session again",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listAgents: () => [
        makeManagedAgent({
          id: agentId,
          provider: "claude",
          cwd,
          sessionId: "archived-live-session",
        }),
      ],
      listImportableSessions: async () => [archivedSession],
    },
    agentStorage: {
      list: async () => [
        {
          id: agentId,
          provider: "claude",
          archivedAt: "2026-04-30T12:01:00.000Z",
          persistence: {
            provider: "claude",
            sessionId: "archived-live-session",
          },
        } as StoredAgentRecord,
      ],
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["archived-live-session"]);
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions filters out metadata generation sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "metadata-session",
      nativeHandle: "metadata-handle",
      cwd,
      title: "Generate metadata for a coding agent based on the user prom...",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
      firstPrompt:
        "Generate metadata for a coding agent based on the user prompt.\nTitle: short descriptive label (<= 40 chars).",
    }),
    makeImportableSession({
      sessionId: "real-session",
      nativeHandle: "real-handle",
      cwd,
      title: "Real session",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "hey hey",
    }),
  ];

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => sessions,
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].providerHandleId).toBe("real-handle");
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions keeps realpath-equivalent cwd matches", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-cwd-"));
  const realCwd = path.join(root, "real-project");
  const linkedCwd = path.join(root, "linked-project");
  mkdirSync(realCwd, { recursive: true });
  symlinkSync(realCwd, linkedCwd, directorySymlinkType);
  const persistedCwd = realpathSync(linkedCwd);

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd: linkedCwd, providers: ["pi"] }),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [
        makeImportableSession({
          provider: "pi",
          sessionId: "pi-session",
          nativeHandle: "pi-handle",
          cwd: persistedCwd,
          title: "Pi session",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
          firstPrompt: "remember this",
        }),
      ],
    } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
    agentStorage: {
      list: async () => [],
    } satisfies Pick<AgentStorage, "list">,
    providerSnapshotManager: { getProviderLabel: () => "Pi" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["pi-handle"]);
});

test("listImportableProviderSessions rejects invalid since values", async () => {
  await expect(
    listImportableProviderSessions({
      request: makeRequest({ since: "not-a-date" }),
      agentManager: {
        listAgents: () => [],
        listImportableSessions: async () => [],
      } satisfies Pick<AgentManager, "listAgents" | "listImportableSessions">,
      agentStorage: {
        list: async () => [],
      } satisfies Pick<AgentStorage, "list">,
      providerSnapshotManager: { getProviderLabel: () => "" },
    }),
  ).rejects.toMatchObject(
    new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since"),
  );
});

test("normalizeImportAgentRequest accepts new and legacy import handle shapes", () => {
  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "new-shape",
      providerId: "custom-codex",
      providerHandleId: "thread-1",
      title: "CLI session title",
    }),
  ).toEqual({
    requestId: "new-shape",
    provider: "custom-codex",
    providerHandleId: "thread-1",
    title: "CLI session title",
  });

  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "legacy-shape",
      provider: "codex",
      sessionId: "thread-2",
    }),
  ).toEqual({
    requestId: "legacy-shape",
    provider: "codex",
    providerHandleId: "thread-2",
  });
});

function makeStoredProviderSession(input: {
  id: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  workspaceId?: string;
  title?: string | null;
  labels?: Record<string, string>;
  archivedAt?: string | null;
}): StoredAgentRecord {
  return {
    id: input.id,
    provider: "codex",
    cwd: input.cwd,
    workspaceId: input.workspaceId ?? "ws-archived",
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T11:00:00.000Z",
    lastActivityAt: "2026-04-30T10:30:00.000Z",
    lastUserMessageAt: null,
    title: input.title ?? null,
    labels: input.labels ?? {},
    config: { provider: "codex", cwd: input.cwd },
    persistence: {
      provider: "codex",
      sessionId: input.sessionId,
      nativeHandle: input.nativeHandle ?? input.sessionId,
      metadata: { provider: "codex", cwd: input.cwd },
    },
    archivedAt: input.archivedAt === undefined ? "2026-04-30T12:00:00.000Z" : input.archivedAt,
  };
}

class ProviderImportHarness {
  readonly storage: AgentStorage;
  readonly manager: ImportSessionAgentManager;
  readonly snapshot: ManagedAgent;
  readonly freshImports: unknown[] = [];
  readonly closedAgentIds: string[] = [];
  timeline: AgentTimelineItem[] = [];
  activeAgent: ManagedAgent | null = null;
  resumeError: Error | null = null;
  closeError: Error | null = null;
  resumeAttempts = 0;
  readonly resumeRequests: unknown[] = [];
  importableSessions: ManagedImportableProviderSession[] = [];
  private unarchiveWait: Promise<void> | null = null;
  private releaseUnarchive: (() => void) | null = null;

  private constructor(input: { storage: AgentStorage; snapshot: ManagedAgent }) {
    this.storage = input.storage;
    this.snapshot = input.snapshot;
    this.manager = {
      listImportableSessions: async () => this.importableSessions,
      importProviderSession: async (request: unknown) => {
        this.freshImports.push(request);
        this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      unarchiveSnapshot: async (
        agentId: string,
        updates?: {
          workspaceId?: string;
          title?: string;
          labels?: Record<string, string | null>;
        },
      ) => {
        if (this.unarchiveWait) {
          await this.unarchiveWait;
        }
        const record = await this.storage.get(agentId);
        if (!record?.archivedAt) {
          return false;
        }
        const labels = { ...record.labels };
        for (const [key, value] of Object.entries(updates?.labels ?? {})) {
          if (value === null) {
            delete labels[key];
          } else {
            labels[key] = value;
          }
        }
        await this.storage.upsert({
          ...record,
          workspaceId: updates?.workspaceId ?? record.workspaceId,
          title: updates?.title ?? record.title,
          labels,
          archivedAt: null,
        });
        return true;
      },
      notifyAgentState: () => {},
      getAgent: () => this.activeAgent,
      getRegisteredProviderIds: () => ["codex"],
      createAgent: async () => {
        throw new Error("Stored provider imports must resume their persisted session");
      },
      resumeAgentFromPersistence: async (
        handle: unknown,
        overrides: unknown,
        agentId?: string,
        options?: unknown,
      ) => {
        this.resumeRequests.push({ handle, overrides, agentId, options });
        this.resumeAttempts += 1;
        if (this.resumeError) {
          this.activeAgent = this.snapshot;
          throw this.resumeError;
        }
        this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      hydrateTimelineFromProvider: async () => {},
      getTimeline: () => this.timeline,
      closeAgent: async (agentId: string) => {
        this.closedAgentIds.push(agentId);
        if (this.closeError) {
          throw this.closeError;
        }
        this.activeAgent = null;
      },
      archiveSnapshot: async (agentId: string, archivedAt: string) => {
        const record = await this.storage.get(agentId);
        if (!record) {
          throw new Error("Agent not found: " + agentId);
        }
        const archived = { ...record, archivedAt };
        await this.storage.upsert(archived);
        return archived;
      },
    } satisfies ImportSessionAgentManager;
  }

  static async create(
    input: {
      id?: string;
      cwd?: string;
      sessionId?: string;
      nativeHandle?: string;
    } = {},
  ): Promise<ProviderImportHarness> {
    const directory = mkdtempSync(path.join(tmpdir(), "provider-import-"));
    importTestDirectories.push(directory);
    const storage = new AgentStorage(path.join(directory, "agents"), createTestLogger());
    await storage.initialize();
    const cwd = input.cwd ?? "/tmp/imported-agent";
    const sessionId = input.sessionId ?? "thread-imported";
    const snapshot = makeManagedAgent({
      id: input.id,
      provider: "codex",
      cwd,
      sessionId,
      nativeHandle: input.nativeHandle,
    });
    return new ProviderImportHarness({ storage, snapshot });
  }

  async seed(record: StoredAgentRecord): Promise<void> {
    await this.storage.upsert(record);
  }

  blockUnarchive(): () => void {
    this.unarchiveWait = new Promise<void>((resolve) => {
      this.releaseUnarchive = resolve;
    });
    return () => {
      this.releaseUnarchive?.();
      this.unarchiveWait = null;
      this.releaseUnarchive = null;
    };
  }

  import(input: {
    providerHandleId: string;
    cwd?: string;
    title?: string;
    labels?: Record<string, string>;
  }) {
    return importProviderSession({
      request: {
        requestId: "import-thread",
        provider: "codex",
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
        title: input.title,
        labels: input.labels,
      },
      workspaceProvisioning: createImportWorkspace("ws-restored"),
      agentManager: this.manager,
      agentStorage: this.storage,
      logger: createTestLogger(),
    });
  }
}

test("importProviderSession uses the provider import path with the requested labels", async () => {
  const harness = await ProviderImportHarness.create();
  harness.timeline = [
    { type: "user_message", text: "Trace recent provider sessions" },
    { type: "assistant_message", text: "I will inspect the provider listing." },
  ];

  const result = await harness.import({
    providerHandleId: "thread-imported",
    cwd: "/tmp/imported-agent",
    title: "CLI session title",
    labels: { source: "import" },
  });

  expect(harness.freshImports).toEqual([
    {
      provider: "codex",
      providerHandleId: "thread-imported",
      cwd: "/tmp/imported-agent",
      workspaceId: "ws-restored",
      title: "CLI session title",
      labels: { source: "import" },
    },
  ]);
  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 2,
    createdWorkspace: null,
  });
});

test("importProviderSession rejects a provider session with an active stored owner", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-active" });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "thread-active",
      archivedAt: null,
    }),
  );

  await expect(
    harness.import({ providerHandleId: "thread-active", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("Provider session is already imported: thread-active");
  expect(harness.freshImports).toEqual([]);
});

test("目录改名后，原生会话已指向新目录时重新显示导入入口", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "relocated-import-"));
  importTestDirectories.push(directory);
  const oldCwd = path.join(directory, "old-name");
  const cwd = path.join(directory, "new-name");
  mkdirSync(cwd);
  const record = makeStoredProviderSession({
    id: "relocated-agent",
    cwd: oldCwd,
    sessionId: "relocated-thread",
    archivedAt: null,
  });
  const session = makeImportableSession({
    sessionId: "relocated-thread",
    cwd,
    lastActivityAt: "2026-09-16T10:00:00.000Z",
  });
  const result = await listImportableProviderSessions({
    request: makeRequest(),
    agentManager: {
      listAgents: () => [],
      listImportableSessions: async () => [session],
    },
    agentStorage: { list: async () => [record] },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["relocated-thread"]);
  expect(result.filteredAlreadyImportedCount).toBe(0);
  expect(result.titleRepairs).toEqual([]);
});

test.each([null, "2026-04-30T12:00:00.000Z"])(
  "重新导入改名目录的会话时保留已有会话身份、配置和创建时间（归档：%s）",
  async (archivedAt) => {
    const directory = mkdtempSync(path.join(tmpdir(), "relocated-import-"));
    importTestDirectories.push(directory);
    const cwd = path.join(directory, "new-name");
    mkdirSync(cwd);
    const harness = await ProviderImportHarness.create({ cwd });
    const original = makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: path.join(directory, "old-name"),
      sessionId: "thread-imported",
      title: "用户的原会话名称",
      archivedAt,
    });
    original.config = { model: "selected-model", thinkingOptionId: "high" };
    await harness.seed(original);
    harness.importableSessions = [
      makeImportableSession({
        sessionId: "thread-imported",
        cwd,
        lastActivityAt: "2026-09-16T10:00:00.000Z",
      }),
    ];

    const result = await harness.import({ providerHandleId: "thread-imported", cwd });

    expect(result.snapshot.id).toBe(original.id);
    expect(harness.freshImports).toEqual([]);
    expect(harness.resumeRequests).toEqual([
      {
        handle: original.persistence,
        overrides: expect.objectContaining({
          cwd,
          model: "selected-model",
          thinkingOptionId: "high",
          title: original.title,
        }),
        agentId: original.id,
        options: expect.objectContaining({
          workspaceId: "ws-restored",
          createdAt: new Date(original.createdAt),
        }),
      },
    ]);
    expect(await harness.storage.get(original.id)).toMatchObject({
      id: original.id,
      cwd,
      archivedAt: null,
    });
  },
);

test("目录恢复失败且运行时清理失败时报告两个错误，不假装回滚成功", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "relocated-import-rollback-"));
  importTestDirectories.push(directory);
  const cwd = path.join(directory, "new-name");
  mkdirSync(cwd);
  const harness = await ProviderImportHarness.create({ cwd });
  const original = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: path.join(directory, "old-name"),
    sessionId: "thread-imported",
    archivedAt: null,
  });
  await harness.seed(original);
  harness.importableSessions = [
    makeImportableSession({
      sessionId: "thread-imported",
      cwd,
      lastActivityAt: "2026-09-16T10:00:00.000Z",
    }),
  ];
  harness.resumeError = new Error("resume failed");
  harness.closeError = new Error("close failed");

  await expect(harness.import({ providerHandleId: "thread-imported", cwd })).rejects.toMatchObject({
    name: "AggregateError",
    cause: harness.resumeError,
    errors: [harness.resumeError, harness.closeError],
  });
  expect(await harness.storage.get(original.id)).toEqual(original);
  expect(harness.freshImports).toEqual([]);
});

test.each(["原目录仍存在", "原生会话未确认", "运行时尚未释放", "恢复失败"])(
  "目录恢复遇到%s时保留原记录，不创建副本或中断其他运行时",
  async (scenario) => {
    const directory = mkdtempSync(path.join(tmpdir(), "relocated-import-failure-"));
    importTestDirectories.push(directory);
    const cwd = path.join(directory, "new-name");
    const oldCwd = path.join(directory, "old-name");
    mkdirSync(cwd);
    const harness = await ProviderImportHarness.create({ cwd });
    const original = makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: oldCwd,
      sessionId: "thread-imported",
      archivedAt: null,
    });
    await harness.seed(original);
    harness.importableSessions = [
      makeImportableSession({
        sessionId: "thread-imported",
        cwd,
        lastActivityAt: "2026-09-16T10:00:00.000Z",
      }),
    ];
    let error: string;
    let expectedResumeAttempts = 0;
    let expectedClosedAgentIds: string[] = [];
    switch (scenario) {
      case "原目录仍存在":
        mkdirSync(oldCwd);
        error = "already imported";
        break;
      case "原生会话未确认":
        harness.importableSessions = [];
        error = "原生会话尚未确认";
        break;
      case "运行时尚未释放":
        harness.activeAgent = harness.snapshot;
        error = "请先释放原会话";
        break;
      case "恢复失败":
        harness.resumeError = new Error("resume failed");
        error = "resume failed";
        expectedResumeAttempts = 1;
        expectedClosedAgentIds = [original.id];
        break;
      default:
        throw new Error(`Unknown test scenario: ${scenario}`);
    }

    await expect(harness.import({ providerHandleId: "thread-imported", cwd })).rejects.toThrow(
      error,
    );
    expect(await harness.storage.get(original.id)).toEqual(original);
    expect(harness.resumeAttempts).toBe(expectedResumeAttempts);
    expect(harness.closedAgentIds).toEqual(expectedClosedAgentIds);
    expect(harness.freshImports).toEqual([]);
  },
);

test("importProviderSession restores an archived session as the same standalone agent", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-archived" });
  harness.timeline = [{ type: "user_message", text: "restored" }];
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-archived",
    labels: { existing: "label", [PARENT_AGENT_ID_LABEL]: "archived-parent" },
  });
  await harness.seed(archived);

  const result = await harness.import({
    providerHandleId: "thread-archived",
    cwd: harness.snapshot.cwd,
    title: "CLI restored title",
    labels: { source: "reimport" },
  });

  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 1,
    createdWorkspace: null,
  });
  expect(await harness.storage.get(harness.snapshot.id)).toMatchObject({
    id: harness.snapshot.id,
    workspaceId: "ws-restored",
    title: "CLI restored title",
    labels: { existing: "label", source: "reimport" },
    archivedAt: null,
  });
  expect((await harness.storage.get(harness.snapshot.id))?.labels).not.toHaveProperty(
    PARENT_AGENT_ID_LABEL,
  );
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.freshImports).toEqual([]);
});

test("importProviderSession rejects an archived session from a different cwd before restoring", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-other-cwd" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: "/tmp/other-agent",
    sessionId: "thread-other-cwd",
  });
  await harness.seed(archived);

  await expect(
    harness.import({ providerHandleId: "thread-other-cwd", cwd: "/tmp/target-agent" }),
  ).rejects.toThrow("Provider session cwd does not match import cwd: thread-other-cwd");
  expect(await harness.storage.get(harness.snapshot.id)).toEqual(archived);
  expect(harness.resumeAttempts).toBe(0);
});

test("importProviderSession restores storage and closes a partial runtime when loading fails", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-stale" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-stale",
  });
  await harness.seed(archived);
  harness.resumeError = new Error("provider session is unavailable");

  await expect(
    harness.import({ providerHandleId: "thread-stale", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("provider session is unavailable");

  expect(await harness.storage.get(harness.snapshot.id)).toEqual(archived);
  expect(harness.activeAgent).toBeNull();
  expect(harness.closedAgentIds).toEqual([harness.snapshot.id]);
});

test("importProviderSession serializes legacy and native aliases for one archived session", async () => {
  const harness = await ProviderImportHarness.create({
    sessionId: "legacy-thread",
    nativeHandle: "native-thread",
  });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "legacy-thread",
      nativeHandle: "native-thread",
    }),
  );
  const releaseUnarchive = harness.blockUnarchive();

  const winningRestore = harness.import({
    providerHandleId: "native-thread",
    cwd: harness.snapshot.cwd,
  });
  const duplicateRestore = harness.import({
    providerHandleId: "legacy-thread",
    cwd: harness.snapshot.cwd,
  });
  releaseUnarchive();

  await expect(winningRestore).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    timelineSize: 0,
  });
  await expect(duplicateRestore).rejects.toThrow(
    "Provider session is already imported: legacy-thread",
  );
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.closedAgentIds).toEqual([]);
});

test("importProviderSession requires cwd from the selected provider row", async () => {
  const harness = await ProviderImportHarness.create();

  await expect(harness.import({ providerHandleId: "thread-imported" })).rejects.toThrow(
    "Import requires cwd from the selected provider session",
  );
});
