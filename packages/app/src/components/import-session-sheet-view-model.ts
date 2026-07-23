import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";

// Protocol allows up to 200 per request; keep the full budget so the sheet is not
// limited to a handful of recent sessions.
export const PER_PROVIDER_LIMIT = 200;
export const ALL_FILTER_VALUE = "__all__";

export function requiresImportSessionsHostUpgrade(input: {
  supportsSnapshot: boolean;
  workspaceId?: string | null;
  supportsWorkspaceTarget: boolean;
}): boolean {
  return !input.supportsSnapshot || (Boolean(input.workspaceId) && !input.supportsWorkspaceTarget);
}

export interface SessionsQueryResult {
  data:
    | {
        entries: FetchRecentProviderSessionEntry[];
        filteredAlreadyImportedCount?: number;
      }
    | undefined;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
}

export function resolveProvidersToFetch(
  supportsSnapshot: boolean,
  snapshotEntries: ReadonlyArray<{ provider: string; enabled?: boolean }> | undefined,
): AgentProvider[] | null {
  // COMPAT(providersSnapshot): the import-recent-sessions feature ships alongside
  // providersSnapshot (v0.1.48, 2026-04-05). Daemons older than that lack both —
  // we render an "update host" empty state instead of degrading. Drop this gate
  // when the supported daemon floor is >= v0.1.48 (target: 2026-10-05).
  if (!supportsSnapshot) return null;
  if (!snapshotEntries) return null;
  return snapshotEntries.filter((entry) => entry.enabled !== false).map((entry) => entry.provider);
}

export function buildProviderLabelMap(
  snapshotEntries: ReadonlyArray<{ provider: string; label?: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!snapshotEntries) return map;
  for (const entry of snapshotEntries) {
    if (entry.label) {
      map.set(entry.provider, entry.label);
    }
  }
  return map;
}

export function aggregateSessionEntries(
  queries: ReadonlyArray<SessionsQueryResult>,
): FetchRecentProviderSessionEntry[] {
  const seen = new Set<string>();
  const collected: FetchRecentProviderSessionEntry[] = [];
  for (const query of queries) {
    if (!query.data) continue;
    for (const entry of query.data.entries) {
      const key = `${entry.providerId}:${entry.providerHandleId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(entry);
    }
  }
  collected.sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  return collected;
}

export function sumFilteredAlreadyImportedCount(
  queries: ReadonlyArray<SessionsQueryResult>,
): number {
  let total = 0;
  for (const query of queries) {
    total += query.data?.filteredAlreadyImportedCount ?? 0;
  }
  return total;
}

export function collectErroredProviderLabels(
  providersToFetch: AgentProvider[] | null,
  queries: ReadonlyArray<SessionsQueryResult>,
  providerLabelById: ReadonlyMap<string, string>,
): string[] {
  if (providersToFetch === null) return [];
  const labels: string[] = [];
  for (let index = 0; index < queries.length; index++) {
    if (queries[index]?.isError) {
      const provider = providersToFetch[index];
      labels.push(providerLabelById.get(provider) ?? provider);
    }
  }
  return labels;
}

export function getSessionTitle(entry: FetchRecentProviderSessionEntry): string {
  const title = entry.title?.trim();
  if (title) {
    return title;
  }
  const firstPromptPreview = entry.firstPromptPreview?.trim();
  if (firstPromptPreview) {
    return firstPromptPreview;
  }
  return i18n.t("importSession.preview.untitledSession");
}

export function getPromptPreview(entry: FetchRecentProviderSessionEntry): string {
  return (
    entry.lastPromptPreview?.trim() ||
    entry.firstPromptPreview?.trim() ||
    i18n.t("importSession.preview.noPrompt")
  );
}

export interface EmptyStateInputs {
  isLoadingSessions: boolean;
  allQueriesErrored: boolean;
  isQueryingProviders: boolean;
  allQueriesSettled: boolean;
  selectedProvider: string;
  searchQuery?: string;
  aggregatedCount: number;
  visibleCount: number;
  totalAlreadyImportedCount: number;
  providerLabelById: ReadonlyMap<string, string>;
}

export function computeEmptyState(input: EmptyStateInputs): {
  showEmptyState: boolean;
  emptyStateTitle: string;
} {
  const showEmptyState =
    !input.isLoadingSessions &&
    !input.allQueriesErrored &&
    input.isQueryingProviders &&
    input.allQueriesSettled &&
    input.visibleCount === 0;
  if (!showEmptyState) {
    return { showEmptyState, emptyStateTitle: "" };
  }
  if (input.searchQuery?.trim()) {
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.noSearchMatches"),
    };
  }
  const isFilteredEmpty = input.selectedProvider !== ALL_FILTER_VALUE && input.aggregatedCount > 0;
  if (isFilteredEmpty) {
    const label = input.providerLabelById.get(input.selectedProvider) ?? input.selectedProvider;
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.noProviderSessions", { provider: label }),
    };
  }
  if (input.totalAlreadyImportedCount > 0) {
    return {
      showEmptyState,
      emptyStateTitle: i18n.t("importSession.empty.alreadyImported"),
    };
  }
  return { showEmptyState, emptyStateTitle: i18n.t("importSession.empty.noRecent") };
}

export function filterSessionEntries(
  entries: readonly FetchRecentProviderSessionEntry[],
  input: {
    selectedProvider: string;
    searchQuery: string;
  },
): FetchRecentProviderSessionEntry[] {
  const query = input.searchQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    if (
      input.selectedProvider !== ALL_FILTER_VALUE &&
      entry.providerId !== input.selectedProvider
    ) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      entry.title,
      entry.firstPromptPreview,
      entry.lastPromptPreview,
      entry.cwd,
      entry.providerLabel,
      entry.providerId,
      entry.providerHandleId,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function normalizeFolderKey(cwd: string | null | undefined): string {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  // Compare folders case-insensitively and ignore trailing separators.
  return trimmed.replace(/[\\/]+$/, "").toLowerCase();
}

export function getFolderLabel(cwd: string | null | undefined): string {
  const trimmed = cwd?.trim() ?? "";
  if (!trimmed) {
    return i18n.t("importSession.folders.unknown");
  }
  return trimmed;
}

export interface ImportSessionFolderGroup {
  key: string;
  label: string;
  entries: FetchRecentProviderSessionEntry[];
}

/**
 * Group sessions by working directory while preserving last-activity order
 * (first-seen folder order follows the already sorted entry list).
 * When `preferredCwd` is set, that folder is pinned to the top.
 */
export function groupSessionEntriesByFolder(
  entries: readonly FetchRecentProviderSessionEntry[],
  preferredCwd?: string | null,
): ImportSessionFolderGroup[] {
  const groups: ImportSessionFolderGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizeFolderKey(entry.cwd);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        key: key || "__unknown__",
        label: getFolderLabel(entry.cwd),
        entries: [entry],
      });
      continue;
    }
    groups[existingIndex]?.entries.push(entry);
  }
  const preferredKey = normalizeFolderKey(preferredCwd);
  if (!preferredKey || groups.length <= 1) {
    return groups;
  }
  const preferredIndex = indexByKey.get(preferredKey);
  if (preferredIndex === undefined || preferredIndex === 0) {
    return groups;
  }
  const preferred = groups[preferredIndex];
  if (!preferred) {
    return groups;
  }
  return [preferred, ...groups.filter((_, index) => index !== preferredIndex)];
}
