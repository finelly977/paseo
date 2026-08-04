import type { CheckoutCommit, CheckoutCommitReference } from "@getpaseo/protocol/messages";
import { useMemo } from "react";
import invariant from "tiny-invariant";
import { useInfiniteFetchQuery } from "@/data/query";
import { checkoutCommitsQueryKey } from "@/git/query-keys";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

const CHECKOUT_COMMITS_STALE_TIME = 30_000;
const CHECKOUT_COMMITS_PAGE_SIZE = 40;

interface UseCheckoutCommitsQueryOptions {
  serverId: string;
  cwd: string;
  enabled?: boolean;
  filter?: CheckoutCommitRefFilter;
}

export type CheckoutCommitRefFilter =
  | { mode: "auto" }
  | { mode: "all" }
  | { mode: "selected"; refs: string[] };

interface CheckoutCommitsPage {
  baseRef: string | null;
  commits: ClassifiedCheckoutCommit[];
  availableRefs: CheckoutCommitReference[];
  headSha: string | null;
  currentRef: string | null;
  upstreamRef: string | null;
  nextCursor: number | null;
}

export interface CheckoutCommitsData {
  baseRef: string | null;
  commits: ClassifiedCheckoutCommit[];
  availableRefs: CheckoutCommitReference[];
  headSha: string | null;
  currentRef: string | null;
  upstreamRef: string | null;
}

export interface ClassifiedCheckoutCommit extends CheckoutCommit {
  isOnBase: boolean;
  parentShas: string[];
  references: CheckoutCommitReference[];
  statistics: {
    files: number;
    additions: number;
    deletions: number;
  };
}

interface CheckoutCommitsPaginationState {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMore: () => void;
}

export type CheckoutCommitsQueryResult =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | ({ status: "loaded"; data: CheckoutCommitsData } & CheckoutCommitsPaginationState);

interface ResolveCheckoutCommitsQueryResultInput {
  enabled: boolean;
  capabilityPresent: boolean;
  canFetch: boolean;
  data: CheckoutCommitsData | undefined;
  isPlaceholderData: boolean;
  error: Error | null;
  pagination: CheckoutCommitsPaginationState;
}

export function resolveCheckoutCommitsQueryResult({
  enabled,
  capabilityPresent,
  canFetch,
  data,
  isPlaceholderData,
  error,
  pagination,
}: ResolveCheckoutCommitsQueryResultInput): CheckoutCommitsQueryResult {
  if (!capabilityPresent) {
    return { status: "unsupported" };
  }
  if (data && !isPlaceholderData) {
    return { status: "loaded", data, ...pagination };
  }
  if (!enabled) {
    return { status: "idle" };
  }
  if (!canFetch) {
    return { status: "connecting" };
  }
  if (error) {
    return { status: "error", error };
  }
  return { status: "loading" };
}

function flattenCommitPages(pages: CheckoutCommitsPage[]): CheckoutCommitsData | undefined {
  const firstPage = pages[0];
  if (!firstPage) {
    return undefined;
  }
  const commits: ClassifiedCheckoutCommit[] = [];
  const seenShas = new Set<string>();
  for (const page of pages) {
    for (const commit of page.commits) {
      if (seenShas.has(commit.sha)) {
        continue;
      }
      seenShas.add(commit.sha);
      commits.push(commit);
    }
  }
  return {
    baseRef: firstPage.baseRef,
    commits,
    availableRefs: firstPage.availableRefs,
    headSha: firstPage.headSha,
    currentRef: firstPage.currentRef,
    upstreamRef: firstPage.upstreamRef,
  };
}

export function useCheckoutCommitsQuery({
  serverId,
  cwd,
  enabled = true,
  filter = { mode: "auto" },
}: UseCheckoutCommitsQueryOptions): CheckoutCommitsQueryResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(commitGraphV2): v0.2.2 新增，2027-02-04 后移除能力门控。
  const capabilityPresent = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.commitsList === true &&
      state.sessions[serverId]?.serverInfo?.features?.commitBaseClassification === true &&
      state.sessions[serverId]?.serverInfo?.features?.commitsPagination === true &&
      state.sessions[serverId]?.serverInfo?.features?.commitGraphV2 === true,
  );
  const selectedRefs = filter.mode === "selected" ? filter.refs : [];

  const canFetch = Boolean(cwd) && Boolean(client) && isConnected;
  const queryEnabled = enabled && capabilityPresent && canFetch;
  const query = useInfiniteFetchQuery<
    CheckoutCommitsPage,
    Error,
    { pages: CheckoutCommitsPage[] },
    ReturnType<typeof checkoutCommitsQueryKey>,
    number
  >({
    queryKey: checkoutCommitsQueryKey(serverId, cwd, filter.mode, selectedRefs),
    queryFn: async ({ pageParam }) => {
      if (!client) {
        throw new Error("主机连接已断开");
      }
      const data = await client.listCheckoutCommits(cwd, {
        cursor: pageParam,
        limit: CHECKOUT_COMMITS_PAGE_SIZE,
        refMode: filter.mode,
        ...(filter.mode === "selected" ? { refs: filter.refs } : {}),
      });
      const commits = data.commits.map((commit) => {
        invariant(commit.isOnBase !== undefined, "主机未返回提交所属分支信息");
        invariant(commit.parentShas !== undefined, "主机未返回提交父级信息");
        invariant(commit.references !== undefined, "主机未返回提交引用信息");
        invariant(commit.statistics !== undefined, "主机未返回提交统计信息");
        return {
          ...commit,
          isOnBase: commit.isOnBase,
          parentShas: commit.parentShas,
          references: commit.references,
          statistics: commit.statistics,
        };
      });
      invariant(data.nextCursor !== undefined, "主机未返回提交历史分页游标");
      invariant(data.availableRefs !== undefined, "主机未返回 Git 引用列表");
      invariant(data.headSha !== undefined, "主机未返回当前提交信息");
      invariant(data.currentRef !== undefined, "主机未返回当前分支引用");
      invariant(data.upstreamRef !== undefined, "主机未返回上游分支引用");
      return {
        baseRef: data.baseRef,
        commits,
        availableRefs: data.availableRefs,
        headSha: data.headSha,
        currentRef: data.currentRef,
        upstreamRef: data.upstreamRef,
        nextCursor: data.nextCursor ?? null,
      };
    },
    enabled: queryEnabled,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTimeMs: CHECKOUT_COMMITS_STALE_TIME,
    dataShape: "list",
  });

  const data = useMemo(() => flattenCommitPages(query.data?.pages ?? []), [query.data?.pages]);
  const loadMore = () => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return;
    }
    void query.fetchNextPage();
  };

  return resolveCheckoutCommitsQueryResult({
    enabled,
    capabilityPresent,
    canFetch,
    data,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pagination: {
      hasNextPage: query.hasNextPage,
      isFetchingNextPage: query.isFetchingNextPage,
      loadMore,
    },
  });
}
