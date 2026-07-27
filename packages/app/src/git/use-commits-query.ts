import type { CheckoutCommit } from "@getpaseo/protocol/messages";
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
}

interface CheckoutCommitsPage {
  baseRef: string | null;
  commits: ClassifiedCheckoutCommit[];
  nextCursor: number | null;
}

export interface CheckoutCommitsData {
  baseRef: string | null;
  commits: ClassifiedCheckoutCommit[];
}

export interface ClassifiedCheckoutCommit extends CheckoutCommit {
  isOnBase: boolean;
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
  return { baseRef: firstPage.baseRef, commits };
}

export function useCheckoutCommitsQuery({
  serverId,
  cwd,
  enabled = true,
}: UseCheckoutCommitsQueryOptions): CheckoutCommitsQueryResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(commitsList): v0.1.110 新增，2027-01-16 后移除能力门控。
  // COMPAT(commitBaseClassification): v0.2.0 新增，2027-01-23 后移除能力门控。
  const capabilityPresent = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.commitsList === true &&
      state.sessions[serverId]?.serverInfo?.features?.commitBaseClassification === true,
  );
  // COMPAT(commitsPagination): v0.2.2 新增，2027-01-27 后移除能力门控。
  const paginationSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.commitsPagination === true,
  );

  const canFetch = Boolean(cwd) && Boolean(client) && isConnected;
  const queryEnabled = enabled && capabilityPresent && canFetch;
  const query = useInfiniteFetchQuery<
    CheckoutCommitsPage,
    Error,
    { pages: CheckoutCommitsPage[] },
    ReturnType<typeof checkoutCommitsQueryKey>,
    number
  >({
    queryKey: checkoutCommitsQueryKey(serverId, cwd),
    queryFn: async ({ pageParam }) => {
      if (!client) {
        throw new Error("主机连接已断开");
      }
      const data = await client.listCheckoutCommits(
        cwd,
        paginationSupported ? { cursor: pageParam, limit: CHECKOUT_COMMITS_PAGE_SIZE } : undefined,
      );
      const commits = data.commits.map((commit) => {
        invariant(commit.isOnBase !== undefined, "主机未返回提交所属分支信息");
        return { ...commit, isOnBase: commit.isOnBase };
      });
      if (paginationSupported) {
        invariant(data.nextCursor !== undefined, "主机未返回提交历史分页游标");
      }
      return {
        baseRef: data.baseRef,
        commits,
        nextCursor: paginationSupported ? (data.nextCursor ?? null) : null,
      };
    },
    enabled: queryEnabled,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTimeMs: CHECKOUT_COMMITS_STALE_TIME,
    dataShape: "list",
  });

  const data = flattenCommitPages(query.data?.pages ?? []);
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
