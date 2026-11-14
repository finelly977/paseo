import { z } from "zod";

const GroupSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  collapsed: z.boolean(),
});
export const SidebarGroupsSchema = z
  .strictObject({
    groups: z.array(GroupSchema),
    membership: z.record(z.string(), z.string()),
    ungroupedCollapsed: z.boolean(),
  })
  .superRefine((project, context) => {
    const ids = new Set(project.groups.map((group) => group.id));
    const names = new Set(project.groups.map((group) => group.name.toLocaleLowerCase()));
    if (ids.size !== project.groups.length || names.size !== project.groups.length)
      context.addIssue({ code: "custom", message: "分组名称或标识重复" });
    if (Object.values(project.membership).some((id) => !ids.has(id)))
      context.addIssue({ code: "custom", message: "工作区所属分组不存在" });
  });
export type SidebarGroups = z.infer<typeof SidebarGroupsSchema>;
export type ProjectGroup = z.infer<typeof GroupSchema>;
export const EMPTY_SIDEBAR_GROUPS: SidebarGroups = {
  groups: [],
  membership: {},
  ungroupedCollapsed: false,
};

interface GroupNameValidation {
  value: string;
  exceptId: string | null;
}
interface GroupRename {
  groupId: string;
  name: string;
}
interface ProjectAssignment {
  projectKey: string;
  groupId: string | null;
}
interface GroupReorder {
  groupId: string;
  offset: -1 | 1;
}
export function validateGroupName(
  project: SidebarGroups,
  { value, exceptId }: GroupNameValidation,
): string | null {
  const name = value.trim();
  if (!name) return "请输入分组名称";
  if (name.length > 40) return "分组名称最多 40 个字符";
  if (name === "未分组") return "请使用其他分组名称";
  if (
    project.groups.some(
      (group) =>
        group.id !== exceptId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    return "已存在同名分组";
  return null;
}

export function requireGroup(project: SidebarGroups, groupId: string): ProjectGroup {
  const group = project.groups.find((entry) => entry.id === groupId);
  if (!group) throw new Error("分组不存在，请重新选择");
  return group;
}

export function renameGroup(project: SidebarGroups, { groupId, name }: GroupRename): SidebarGroups {
  const error = validateGroupName(project, { value: name, exceptId: groupId });
  if (error) throw new Error(error);
  requireGroup(project, groupId);
  return {
    ...project,
    groups: project.groups.map((group) =>
      group.id === groupId ? { ...group, name: name.trim() } : group,
    ),
  };
}

export function removeGroup(project: SidebarGroups, groupId: string): SidebarGroups {
  requireGroup(project, groupId);
  return {
    ...project,
    groups: project.groups.filter((group) => group.id !== groupId),
    membership: Object.fromEntries(
      Object.entries(project.membership).filter(([, id]) => id !== groupId),
    ),
    ungroupedCollapsed: false,
  };
}

export function assignProject(
  project: SidebarGroups,
  { projectKey, groupId }: ProjectAssignment,
): SidebarGroups {
  const membership = { ...project.membership };
  if (groupId === null) {
    delete membership[projectKey];
    return { ...project, membership, ungroupedCollapsed: false };
  }
  requireGroup(project, groupId);
  membership[projectKey] = groupId;
  return {
    ...project,
    membership,
    groups: project.groups.map((group) =>
      group.id === groupId ? { ...group, collapsed: false } : group,
    ),
  };
}

export function reorderGroup(
  project: SidebarGroups,
  { groupId, offset }: GroupReorder,
): SidebarGroups {
  requireGroup(project, groupId);
  const index = project.groups.findIndex((group) => group.id === groupId);
  const target = index + offset;
  if (target < 0 || target >= project.groups.length) return project;
  const groups = [...project.groups];
  [groups[index], groups[target]] = [groups[target], groups[index]];
  return { ...project, groups };
}

interface GroupedProject {
  projectKey: string;
}
interface ProjectGroupBucket<T> extends ProjectGroup {
  projects: T[];
}
export function partitionProjects<T extends GroupedProject>(
  project: SidebarGroups,
  projects: readonly T[],
) {
  const groups: ProjectGroupBucket<T>[] = project.groups.map((group) => ({
    ...group,
    projects: [],
  }));
  const members = new Map(groups.map((group) => [group.id, group.projects]));
  const ungrouped: T[] = [];
  for (const entry of projects) {
    const id = project.membership[entry.projectKey];
    if (id === undefined) ungrouped.push(entry);
    else {
      const list = members.get(id);
      if (!list) throw new Error("工作区所属分组不存在");
      list.push(entry);
    }
  }
  return { groups, ungrouped };
}
