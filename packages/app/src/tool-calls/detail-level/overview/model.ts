import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import { describeToolCall, isThoughtProcessItem, type ToolCallRun } from "../grouping";

const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewSummary {
  thoughtCount: number;
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isPaseoCall(name: string, normalizedName: string): boolean {
  return isPaseoToolName(name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

export function isSingleThoughtOverviewGroup(group: OverviewToolCallGroup): boolean {
  const first = group.run.calls[0];
  return group.run.calls.length === 1 && first !== undefined && isThoughtProcessItem(first);
}

export function isThoughtOnlyOverviewSummary(summary: OverviewSummary): boolean {
  return (
    summary.thoughtCount > 0 &&
    summary.editedFileCount === 0 &&
    summary.commandCount === 0 &&
    summary.readFileCount === 0 &&
    summary.searchCount === 0 &&
    summary.otherToolCount === 0 &&
    summary.paseoCallCount === 0
  );
}

export function resolveOverviewGroupExpanded(input: {
  groupId: string;
  isSealed: boolean;
  isCompact: boolean;
  overrides: ReadonlyMap<string, boolean>;
}): boolean {
  const explicit = input.overrides.get(input.groupId);
  if (explicit !== undefined) {
    return explicit;
  }
  if (input.isCompact) {
    return false;
  }
  return !input.isSealed;
}

export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let thoughtCount = 0;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;

  for (const call of run.calls) {
    if (call.kind === "thought") {
      thoughtCount += 1;
      isLoading ||= call.status === "loading";
      continue;
    }
    const descriptor = describeToolCall(call);
    const normalizedName = descriptor.name.trim().toLowerCase();
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    if (normalizedName === "thinking") {
      thoughtCount += 1;
    } else if (isPaseoCall(descriptor.name, normalizedName)) {
      paseoCallCount += 1;
    } else if (descriptor.detail.type === "edit") {
      const filePaths = descriptor.detail.filePaths ?? [descriptor.detail.filePath];
      for (const filePath of filePaths) {
        editedFiles.add(filePath);
      }
    } else if (descriptor.detail.type === "write") {
      editedFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "shell") {
      commandCount += 1;
    } else if (descriptor.detail.type === "read") {
      readFiles.add(descriptor.detail.filePath);
    } else if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
      searchCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  const summary: OverviewSummary = {
    thoughtCount,
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    paseoCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}
