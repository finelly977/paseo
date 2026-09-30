import type { WorkspaceEntryMutation } from "@getpaseo/protocol/messages";
import type { ExplorerEntry } from "@/stores/session-store";
import type { ExplorerTreeRow } from "./tree";

export type EntryAction =
  | { operation: "create"; parent: string; kind: "file" | "directory" }
  | { operation: "rename"; entry: ExplorerEntry }
  | { operation: "delete"; entry: ExplorerEntry };

export interface EntryActionState {
  action: EntryAction;
  name: string;
  error: string | null;
}

export type ExplorerDisplayRow = ExplorerTreeRow | { draftParent: string; depth: number };

export function explorerRowsWithDraft(
  rows: ExplorerTreeRow[],
  state: EntryActionState | null,
): ExplorerDisplayRow[] {
  if (!state || state.action.operation !== "create") return rows;
  const parent = state.action.parent;
  const parentIndex = rows.findIndex((row) => row.entry.path === parent);
  const depth = parentIndex < 0 ? 0 : rows[parentIndex].depth + 1;
  const result: ExplorerDisplayRow[] = [...rows];
  result.splice(parentIndex + 1, 0, { draftParent: parent, depth });
  return result;
}

export function explorerCreateParent(entry: ExplorerEntry | undefined): string {
  if (!entry) return ".";
  if (entry.kind === "directory") return entry.path;
  const separator = entry.path.lastIndexOf("/");
  return separator < 0 ? "." : entry.path.slice(0, separator);
}

export function renameNameSelection(name: string): { start: number; end: number } {
  const extension = name.lastIndexOf(".");
  return { start: 0, end: extension > 0 ? extension : name.length };
}

export function buildEntryMutation(state: EntryActionState): WorkspaceEntryMutation {
  const { action } = state;
  if (action.operation === "delete")
    return {
      operation: "delete",
      path: action.entry.path,
      expectedModifiedAt: action.entry.modifiedAt,
    };
  const name = state.name.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.includes("\0")) {
    throw new Error("请输入不含路径分隔符的名称");
  }
  if (action.operation === "rename")
    return {
      operation: "rename",
      path: action.entry.path,
      name,
      expectedModifiedAt: action.entry.modifiedAt,
    };
  const path = action.parent === "." ? name : `${action.parent}/${name}`;
  return { operation: "create", path, kind: action.kind };
}
