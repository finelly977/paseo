import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { applyWorkspaceLocalPins, splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";

function placement(workspaceKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey,
    serverId: "s1",
    workspaceId: workspaceKey,
    projectKey: "p1",
    projectName: "Project 1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceKey,
  };
}

function project(projectKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: "",
    hosts: [],
    workspaces,
  };
}

describe("applyWorkspaceLocalPins", () => {
  it("所有会话置顶时仍留在原工作区", () => {
    const only = placement("w1");
    const projects = [project("p1", [only])];
    const result = applyWorkspaceLocalPins({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
    });
    expect(result).toEqual(projects);
  });

  it("keeps a genuinely empty project so its new-workspace row stays reachable", () => {
    const projects = [project("p1", [])];
    const result = applyWorkspaceLocalPins({
      projects,
      keys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    });
    expect(result).toHaveLength(1);
  });

  it("只在原工作区内把置顶会话排到前面", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = applyWorkspaceLocalPins({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w2"],
        pinnedAtByKey: { w2: "2026-01-01T00:00:00Z" },
      },
    });
    expect(result[0]?.workspaces.map((workspace) => workspace.workspaceKey)).toEqual(["w2", "w1"]);
  });

  it("每个工作区独立按最近置顶时间排序", () => {
    const projects = [
      project("p1", [placement("regular"), placement("older"), placement("newer")]),
      project("p2", [{ ...placement("other"), projectKey: "p2", projectName: "p2" }]),
    ];
    const result = applyWorkspaceLocalPins({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
    });

    expect(result[0]?.workspaces.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
      "regular",
    ]);
    expect(result[1]?.workspaces.map((workspace) => workspace.workspaceKey)).toEqual(["other"]);
  });
});

describe("splitPinnedSidebarGroups", () => {
  it("把全局置顶会话提升到独立分组，并从原工作区移除", () => {
    const projects = [project("p1", [placement("regular"), placement("pinned")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["pinned"],
        pinnedAtByKey: { pinned: "2026-09-22T08:00:00.000Z" },
      },
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual(["pinned"]);
    expect(
      result.unpinnedProjects[0]?.workspaces.map((workspace) => workspace.workspaceKey),
    ).toEqual(["regular"]);
  });

  it("按最近置顶时间排列全局置顶会话", () => {
    const projects = [project("p1", [placement("older"), placement("newer")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-09-21T08:00:00.000Z",
          newer: "2026-09-22T08:00:00.000Z",
        },
      },
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
    ]);
  });
});
