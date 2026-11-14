import { describe, expect, it } from "vitest";
import {
  assignProject,
  EMPTY_SIDEBAR_GROUPS,
  partitionProjects,
  removeGroup,
  renameGroup,
  reorderGroup,
  SidebarGroupsSchema,
  validateGroupName,
  type SidebarGroups,
} from "./model";

const project: SidebarGroups = {
  groups: [
    { id: "one", name: "开发", collapsed: true },
    { id: "two", name: "资料", collapsed: false },
  ],
  membership: { "host-a:one": "one", "host-b:one": "two" },
  ungroupedCollapsed: true,
};

describe("工作区目录分组", () => {
  it("按稳定工作区标识分类，保留组内顺序且不重复工作区", () => {
    const rows = ["host-b:one", "host-a:one", "host-a:two"].map((projectKey) => ({
      projectKey,
      workspaces: [{ workspaceKey: `${projectKey}:session` }],
    }));
    const result = partitionProjects(project, rows);
    expect(result.groups.map((group) => group.projects)).toEqual([[rows[1]], [rows[0]]]);
    expect(result.ungrouped).toEqual([rows[2]]);
    expect(result.groups[0].projects[0]).toBe(rows[1]);
    expect(result.groups[0].projects[0].workspaces).toBe(rows[1].workspaces);
    expect(rows.map((row) => row.projectKey)).toEqual(["host-b:one", "host-a:one", "host-a:two"]);
  });
  it("移动工作区替换所属分组，并展开目标组", () => {
    const moved = assignProject(project, { projectKey: "host-b:one", groupId: "one" });
    expect(moved.membership["host-b:one"]).toBe("one");
    expect(moved.groups[0].collapsed).toBe(false);
    expect(project.groups[0].collapsed).toBe(true);
    expect(assignProject(moved, { projectKey: "host-b:one", groupId: null }).membership).toEqual({
      "host-a:one": "one",
    });
  });
  it("删除分组只解除归类，其余组和工作区标识保留", () => {
    const next = removeGroup(project, "one");
    expect(next.membership).toEqual({ "host-b:one": "two" });
    expect(next.groups.map((group) => group.id)).toEqual(["two"]);
    expect(next.ungroupedCollapsed).toBe(false);
    expect(partitionProjects(next, [{ projectKey: "host-a:one" }]).ungrouped).toHaveLength(1);
  });
  it("重命名与组排序不改变所属关系", () => {
    const renamed = renameGroup(project, { groupId: "one", name: "  产品  " });
    expect(renamed.groups[0].name).toBe("产品");
    const reordered = reorderGroup(renamed, { groupId: "one", offset: 1 });
    expect(reordered.groups.map((group) => group.id)).toEqual(["two", "one"]);
    expect(reordered.membership).toEqual(project.membership);
    expect(reorderGroup(project, { groupId: "one", offset: -1 })).toBe(project);
  });
  it.each(["", "   ", "未分组", "x".repeat(41), "开发"])("拒绝不可用的分组名称：%s", (value) => {
    expect(validateGroupName(project, { value, exceptId: null })).not.toBeNull();
  });
  it("自身名称可保留；名称按去空格和不区分大小写去重", () => {
    expect(validateGroupName(project, { value: "开发", exceptId: "one" })).toBeNull();
    const current = {
      ...EMPTY_SIDEBAR_GROUPS,
      groups: [{ id: "a", name: "Work", collapsed: false }],
    };
    expect(validateGroupName(current, { value: " work ", exceptId: null })).toBe("已存在同名分组");
  });
  it("不存在的分组明确失败，不静默归入其他组", () => {
    expect(() => assignProject(project, { projectKey: "host-a:new", groupId: "gone" })).toThrow(
      "分组不存在",
    );
    expect(() =>
      SidebarGroupsSchema.parse({ ...project, membership: { directory: "gone" } }),
    ).toThrow();
    expect(() =>
      SidebarGroupsSchema.parse({
        ...project,
        groups: [project.groups[0], project.groups[0]],
      }),
    ).toThrow();
  });
});
