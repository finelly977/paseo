import type { CheckoutScmChanges, CheckoutScmFileStatus } from "@getpaseo/protocol/messages";

export type ScmStatusTone = "added" | "modified" | "deleted" | "untracked" | "conflict";

export interface ScmStatusDecoration {
  label: string;
  tone: ScmStatusTone;
}

export type ScmGroupKind = "conflicts" | "staged" | "unstaged";

export interface ScmListGroup {
  group: ScmGroupKind;
  title: string;
  changes: CheckoutScmChanges["staged"];
  collapsed: boolean;
}

export type ScmListItem =
  | ({ type: "header" } & ScmListGroup)
  | {
      type: "file";
      group: ScmGroupKind;
      change: CheckoutScmChanges["staged"][number];
    };

export function getScmStatusDecoration(status: CheckoutScmFileStatus): ScmStatusDecoration {
  switch (status) {
    case "added":
      return { label: "A", tone: "added" };
    case "modified":
      return { label: "M", tone: "modified" };
    case "deleted":
      return { label: "D", tone: "deleted" };
    case "renamed":
      return { label: "R", tone: "modified" };
    case "copied":
      return { label: "C", tone: "added" };
    case "untracked":
      return { label: "U", tone: "untracked" };
    case "conflict":
      return { label: "!", tone: "conflict" };
  }
}

export function splitScmPath(path: string): { fileName: string; directory: string } {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex < 0) {
    return { fileName: path, directory: "" };
  }
  return {
    fileName: path.slice(separatorIndex + 1),
    directory: path.slice(0, separatorIndex),
  };
}

export function countScmChanges(changes: CheckoutScmChanges): number {
  return changes.staged.length + changes.unstaged.length + changes.conflicts.length;
}

export function buildScmListItems(groups: readonly ScmListGroup[]): ScmListItem[] {
  const items: ScmListItem[] = [];
  for (const group of groups) {
    if (group.changes.length === 0) {
      continue;
    }
    items.push({ type: "header", ...group });
    if (group.collapsed) {
      continue;
    }
    for (const change of group.changes) {
      items.push({ type: "file", group: group.group, change });
    }
  }
  return items;
}
