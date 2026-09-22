import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(id: string, statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done") {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectKey: "project",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    providerSessionId: null,
    agentProvider: null,
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
  return { placement, entry };
}

function makeProject(workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    projectKey: "project",
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: "srv",
        projectId: "project",
        iconWorkingDir: "/repo",
        canCreateWorktree: true,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: { groupMode?: "project" | "status" }) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  pinned.entry.pinnedAt = "2026-07-12T12:00:00.000Z";
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: {
        [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z",
      },
    },
    projectPinnedKeys: {
      pinnedWorkspaceKeys: [],
      pinnedAtByKey: {},
    },
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: false,
    collapsedProjectKeys: new Set<string>(),
    collapsedStatusGroupKeys: new Set<string>(),
  };
}

describe("buildSidebarProjection", () => {
  it("把全局置顶会话提升到独立分组并优先生成快捷键", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    expect(projection.projects[0]?.workspaces.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("状态视图中全局置顶会话不再重复出现在状态分组", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.statusGroups.map((group) => group.bucket)).toEqual(["needs_input"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("工作区内置顶只在原项目中提前", () => {
    const input: Parameters<typeof buildSidebarProjection>[0] = projectionInput();
    input.pinnedKeys = { pinnedWorkspaceKeys: [], pinnedAtByKey: {} };
    input.projectPinnedKeys = {
      pinnedWorkspaceKeys: ["srv:unpinned"],
      pinnedAtByKey: { "srv:unpinned": "2026-09-22T08:00:00.000Z" },
    };

    const projection = buildSidebarProjection(input);

    expect(projection.pinnedGroups.pinnedChats).toEqual([]);
    expect(projection.projects[0]?.workspaces.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
      "pinned",
    ]);
  });
});
