import { afterEach, describe, expect, it } from "vitest";

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";
import {
  DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT,
  DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT,
} from "@/timeline/conversation-history-policy";

import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type WorkspaceDescriptor,
} from "./session-store";
import { patchWorkspaceScripts } from "../contexts/session-workspace-scripts";

function createWorkspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  };
}

afterEach(() => {
  useSessionStore.getState().clearSession("test-server");
  useSessionStore.getState().setConversationHistoryPolicy({
    perConversationLoadCount: DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT,
    totalConversationLimit: DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT,
  });
});

function conversationItems(prefix: string, count: number): StreamItem[] {
  return Array.from({ length: count }, (_, index) => [
    {
      kind: "user_message" as const,
      id: `${prefix}-用户-${index}`,
      text: `${prefix} ${index}`,
      timestamp: new Date(1_000 + index * 2),
      timelineCursor: { epoch: "epoch", seq: index * 2 + 1 },
    },
    {
      kind: "assistant_message" as const,
      id: `${prefix}-助手-${index}`,
      text: "完成",
      timestamp: new Date(1_001 + index * 2),
      timelineCursor: { epoch: "epoch", seq: index * 2 + 2 },
    },
  ]).flat();
}

describe("对话历史内存预算", () => {
  it("优先保留当前会话并让被裁剪的旧会话下次重新加载", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setConversationHistoryPolicy({
      perConversationLoadCount: 2,
      totalConversationLimit: 3,
    });
    store.setFocusedAgentId("test-server", "旧会话");
    store.setAgentStreamTail("test-server", new Map([["旧会话", conversationItems("旧", 2)]]));
    store.setAgentTimelineCursor(
      "test-server",
      new Map([["旧会话", { epoch: "epoch", startSeq: 1, endSeq: 4 }]]),
    );
    store.setAgentAuthoritativeHistoryApplied("test-server", "旧会话", true);

    store.setFocusedAgentId("test-server", "当前会话");
    store.setAgentStreamTail("test-server", (previous) =>
      new Map(previous).set("当前会话", conversationItems("当前", 2)),
    );
    store.enforceConversationHistoryMemory();

    const session = useSessionStore.getState().sessions["test-server"];
    expect(
      session?.agentStreamTail.get("当前会话")?.filter((item) => item.kind === "user_message"),
    ).toHaveLength(2);
    expect(
      session?.agentStreamTail.get("旧会话")?.filter((item) => item.kind === "user_message"),
    ).toHaveLength(1);
    expect(session?.agentAuthoritativeHistoryApplied.has("旧会话")).toBe(false);
    expect(session?.agentTimelineCursor.has("旧会话")).toBe(false);
    expect(session?.agentConversationIndex.has("旧会话")).toBe(false);
  });

  it("在正文和服务端游标都提交后同步更新裁剪起点", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setConversationHistoryPolicy({
      perConversationLoadCount: 2,
      totalConversationLimit: 1,
    });
    store.setFocusedAgentId("test-server", "当前会话");
    store.setAgentStreamTail("test-server", new Map([["当前会话", conversationItems("当前", 2)]]));
    store.setAgentTimelineCursor(
      "test-server",
      new Map([["当前会话", { epoch: "epoch", startSeq: 1, endSeq: 4 }]]),
    );
    store.enforceConversationHistoryMemory();

    const session = useSessionStore.getState().sessions["test-server"];
    expect(session?.agentStreamTail.get("当前会话")?.[0]?.id).toBe("当前-用户-1");
    expect(session?.agentTimelineCursor.get("当前会话")).toEqual({
      epoch: "epoch",
      startSeq: 3,
      endSeq: 4,
    });
  });

  it("清空后台主机焦点时不改变当前会话的最近打开顺序", () => {
    initializeTestSession();
    useSessionStore.getState().initializeSession("后台主机", null as unknown as DaemonClient);
    const store = useSessionStore.getState();

    store.setFocusedAgentId("后台主机", "后台会话");
    store.setFocusedAgentId("test-server", "当前会话");
    const openedAtBefore = new Map(useSessionStore.getState().conversationHistoryOpenedAt);

    store.setFocusedAgentId("后台主机", null);

    expect(useSessionStore.getState().conversationHistoryOpenedAt).toEqual(openedAtBefore);
    useSessionStore.getState().clearSession("后台主机");
  });
});

function initializeTestSession(): void {
  useSessionStore.getState().initializeSession("test-server", null as unknown as DaemonClient);
}

function getTestSessionReferences() {
  const state = useSessionStore.getState();
  const session = state.sessions["test-server"];
  if (!session) {
    throw new Error("test session is not initialized");
  }
  return {
    sessions: state.sessions,
    session,
    workspaces: session.workspaces,
  };
}

describe("normalizeWorkspaceDescriptor", () => {
  it("normalizes workspace scripts and invalid activity timestamps", () => {
    const scripts = [
      {
        scriptName: "web",
        type: "service" as const,
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running" as const,
        health: "healthy" as const,
        exitCode: null,
        terminalId: null,
      },
    ];
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "running",
      statusEnteredAt: null,
      activityAt: "not-a-date",
      diffStat: null,
      scripts,
    });

    expect(workspace.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
    expect(workspace.scripts).not.toBe(scripts);
  });

  it("canonicalizes the workspace directory and treats a blank one as empty", () => {
    const canonical = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo/app/",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(canonical.workspaceDirectory).toBe("/repo/app");

    const blank = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "   ",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(blank.workspaceDirectory).toBe("");
  });

  it("defaults missing scripts to an empty array", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.scripts).toEqual([]);
  });

  it("defaults missing archivingAt to null", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "done",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as unknown as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.archivingAt).toBeNull();
  });

  it("normalizes statusEnteredAt strings to Date and missing or null values to null", () => {
    const basePayload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "running",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } satisfies Omit<WorkspaceDescriptorPayload, "statusEnteredAt" | "archivingAt">;

    const withString = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: "2026-05-12T09:30:00.000Z",
    });
    const withNull = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: null,
    });
    const missing = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
    } as unknown as WorkspaceDescriptorPayload);

    expect(withString.statusEnteredAt).toEqual(new Date("2026-05-12T09:30:00.000Z"));
    expect(withNull.statusEnteredAt).toBeNull();
    expect(missing.statusEnteredAt).toBeNull();
  });

  it("preserves project placement from workspace descriptor payloads", () => {
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "remote:github.com/acme/app",
      projectDisplayName: "acme/app",
      projectRootPath: "/repo/app",
      workspaceDirectory: "/repo/app",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
      project: {
        projectKey: "remote:github.com/acme/app",
        projectName: "acme/app",
        checkout: {
          cwd: "/repo/app",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "https://github.com/acme/app.git",
          worktreeRoot: "/repo/app",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });

    expect(workspace.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });
});

describe("mergeWorkspaces", () => {
  it("preserves scripts on merged workspace entries", () => {
    const store = useSessionStore.getState();
    store.initializeSession("test-server", null as unknown as DaemonClient);
    store.setWorkspaces(
      "test-server",
      new Map([["/repo/main", createWorkspace({ id: "/repo/main", scripts: [] })]]),
    );

    store.mergeWorkspaces("test-server", [
      createWorkspace({
        id: "/repo/main",
        scripts: [
          {
            scriptName: "web",
            type: "service",
            hostname: "web.paseo.localhost",
            port: 3000,
            proxyUrl: "http://web.paseo.localhost:6767",
            lifecycle: "running",
            health: "healthy",
            exitCode: null,
            terminalId: null,
          },
        ],
      }),
    ]);

    expect(store.getSession("test-server")?.workspaces.get("/repo/main")?.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
  });

  it("preserves identity when merging content-equal workspace descriptors", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });

    store.mergeWorkspaces("test-server", [workspace]);
    const first = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, scripts: [...workspace.scripts] }]);
    const second = getTestSessionReferences();

    expect(second.sessions).toBe(first.sessions);
    expect(second.session).toBe(first.session);
    expect(second.workspaces).toBe(first.workspaces);
    expect(second.workspaces.get("/repo/main")).toBe(first.workspaces.get("/repo/main"));
  });

  it("preserves unaffected workspace entry identity when one workspace changes", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspaceA = createWorkspace({ id: "/repo/a", name: "main" });
    const workspaceB = createWorkspace({ id: "/repo/b", name: "feature" });

    store.mergeWorkspaces("test-server", [workspaceA, workspaceB]);
    const before = getTestSessionReferences();
    const beforeA = before.workspaces.get("/repo/a");
    const beforeB = before.workspaces.get("/repo/b");

    store.mergeWorkspaces("test-server", [{ ...workspaceA, status: "running" }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get("/repo/a")).not.toBe(beforeA);
    expect(after.workspaces.get("/repo/b")).toBe(beforeB);
  });

  it("uses incoming null diff stat as authoritative", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({
      id: "/repo/main",
      diffStat: { additions: 2, deletions: 1 },
    });
    store.mergeWorkspaces("test-server", [workspace]);
    const before = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, diffStat: null }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)?.diffStat).toBeNull();
  });
});

describe("setWorkspaces", () => {
  it("preserves identity when replacing workspaces with content-equal entries", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.setWorkspaces(
      "test-server",
      new Map([[workspace.id, { ...workspace, scripts: [...workspace.scripts] }]]),
    );
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)).toBe(before.workspaces.get(workspace.id));
  });
});

describe("removeWorkspace", () => {
  it("preserves identity when removing a missing workspace", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.removeWorkspace("test-server", "/repo/missing");
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
  });
});

describe("patchWorkspaceScripts", () => {
  it("preserves workspace entry identity when scripts are content-equal", () => {
    const script = {
      scriptName: "web",
      type: "service" as const,
      hostname: "web.paseo.localhost",
      port: 3000,
      proxyUrl: "http://web.paseo.localhost:6767",
      lifecycle: "running" as const,
      health: "healthy" as const,
      exitCode: null,
      terminalId: null,
    };
    const workspace = createWorkspace({ id: "/repo/main", scripts: [script] });
    const current = new Map([[workspace.id, workspace]]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: workspace.id,
      scripts: [{ ...script }],
    });

    expect(next).toBe(current);
    expect(next.get(workspace.id)).toBe(workspace);
  });
});
