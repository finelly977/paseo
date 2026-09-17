import type { Query, QueryClient } from "@tanstack/react-query";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { prPanePipelineQueryKind, prPaneTimelineQueryKind } from "./pull-request-panel/query-keys";

interface CheckoutQueryIdentity {
  serverId: string;
  cwd: string;
}

interface CheckoutQueryScope {
  serverId: string;
  cwd?: string;
}

type CheckoutQueryKey = readonly [kind: string, serverId: string, cwd: string, ...rest: unknown[]];

type CheckoutQueryKind = "checkoutStatus" | "checkoutDiff" | "checkoutPrStatus" | "checkoutCommits";

export type DisabledCheckoutQueryKey = readonly [
  kind: "disabledCheckoutQuery",
  queryKind: CheckoutQueryKind,
  serverId: string,
];

// A commit's file diff is immutable for a given sha+path, so every consumer
// can share the same long-lived cache policy.
export const COMMIT_FILE_DIFF_STALE_TIME = 5 * 60_000;

/**
 * Git 事件使用守护进程解析后的工作目录，界面路由可能仍保留原始斜杠或尾部斜杠。
 * 查询键统一路径形式，确保推送状态能命中当前挂载的查询。
 */
export function normalizeCheckoutCwd(cwd: string): string {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    throw new Error("Git 工作区路径不能为空");
  }
  return normalized;
}

/**
 * 工作区副本恢复期间，界面可能先拿到工作区标识、后拿到工作目录。
 * 这只表示当前查询尚不可执行，不应在 React 渲染阶段构造严格查询键时击穿整个应用。
 */
export function normalizeOptionalCheckoutCwd(cwd: string): string | null {
  const normalized = normalizeWorkspacePath(cwd);
  return normalized || null;
}

function disabledCheckoutQueryKey(
  queryKind: CheckoutQueryKind,
  serverId: string,
): DisabledCheckoutQueryKey {
  return ["disabledCheckoutQuery", queryKind, serverId] as const;
}

export function checkoutStatusQueryKey(serverId: string, cwd: string) {
  return ["checkoutStatus", serverId, normalizeCheckoutCwd(cwd)] as const;
}

export function checkoutStatusQueryKeyWhenAvailable(serverId: string, cwd: string) {
  const normalizedCwd = normalizeOptionalCheckoutCwd(cwd);
  return normalizedCwd
    ? checkoutStatusQueryKey(serverId, normalizedCwd)
    : disabledCheckoutQueryKey("checkoutStatus", serverId);
}

export function checkoutDiffQueryKey(
  serverId: string,
  cwd: string,
  mode: "uncommitted" | "base",
  baseRef?: string,
  ignoreWhitespace?: boolean,
) {
  return [
    "checkoutDiff",
    serverId,
    normalizeCheckoutCwd(cwd),
    mode,
    baseRef ?? "",
    ignoreWhitespace === true,
  ] as const;
}

export function checkoutDiffQueryKeyWhenAvailable(
  serverId: string,
  cwd: string,
  mode: "uncommitted" | "base",
  baseRef?: string,
  ignoreWhitespace?: boolean,
) {
  const normalizedCwd = normalizeOptionalCheckoutCwd(cwd);
  return normalizedCwd
    ? checkoutDiffQueryKey(serverId, normalizedCwd, mode, baseRef, ignoreWhitespace)
    : disabledCheckoutQueryKey("checkoutDiff", serverId);
}

export function checkoutPrStatusQueryKey(serverId: string, cwd: string) {
  return ["checkoutPrStatus", serverId, normalizeCheckoutCwd(cwd)] as const;
}

export function checkoutPrStatusQueryKeyWhenAvailable(serverId: string, cwd: string) {
  const normalizedCwd = normalizeOptionalCheckoutCwd(cwd);
  return normalizedCwd
    ? checkoutPrStatusQueryKey(serverId, normalizedCwd)
    : disabledCheckoutQueryKey("checkoutPrStatus", serverId);
}

export function checkoutCommitsQueryKey(
  serverId: string,
  cwd: string,
  refMode?: "auto" | "all" | "selected",
  refs: readonly string[] = [],
) {
  if (!refMode) {
    return ["checkoutCommits", serverId, normalizeCheckoutCwd(cwd)] as const;
  }
  return ["checkoutCommits", serverId, normalizeCheckoutCwd(cwd), refMode, ...refs] as const;
}

export function checkoutCommitsQueryKeyWhenAvailable(
  serverId: string,
  cwd: string,
  refMode?: "auto" | "all" | "selected",
  refs: readonly string[] = [],
) {
  const normalizedCwd = normalizeOptionalCheckoutCwd(cwd);
  return normalizedCwd
    ? checkoutCommitsQueryKey(serverId, normalizedCwd, refMode, refs)
    : disabledCheckoutQueryKey("checkoutCommits", serverId);
}

export function checkoutCommitFileDiffQueryKey(
  serverId: string,
  cwd: string,
  sha: string,
  path: string,
) {
  return ["checkoutCommitFileDiff", serverId, normalizeCheckoutCwd(cwd), sha, path] as const;
}

export async function invalidateCheckoutGitQueriesForClient(
  queryClient: QueryClient,
  identity: CheckoutQueryIdentity,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: checkoutStatusQueryKey(identity.serverId, identity.cwd),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("checkoutDiff", identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate("checkoutPrStatus", identity),
    }),
    queryClient.invalidateQueries({
      queryKey: checkoutCommitsQueryKey(identity.serverId, identity.cwd),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate(prPaneTimelineQueryKind, identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate(prPanePipelineQueryKind, identity),
    }),
  ]);
}

// checkoutDiff is excluded: diff queries are subscription-fed (queryFn: skipToken) and
// receive a fresh snapshot on every resubscribe, so invalidation cannot and need not
// refetch them.
export async function invalidateCheckoutGitQueriesForServer(
  queryClient: QueryClient,
  serverId: string,
) {
  const kinds = [
    "checkoutStatus",
    "checkoutPrStatus",
    "checkoutCommits",
    prPaneTimelineQueryKind,
    prPanePipelineQueryKind,
  ];
  await Promise.all(
    kinds.map((kind) =>
      queryClient.invalidateQueries({ predicate: checkoutQueryPredicate(kind, { serverId }) }),
    ),
  );
}

export async function invalidatePrPaneTimelineForCheckout(
  queryClient: QueryClient,
  identity: CheckoutQueryIdentity,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate(prPaneTimelineQueryKind, identity),
    }),
    queryClient.invalidateQueries({
      predicate: checkoutQueryPredicate(prPanePipelineQueryKind, identity),
    }),
  ]);
}

function checkoutQueryPredicate(
  queryKind: CheckoutQueryKey[0],
  scope: CheckoutQueryScope,
): (query: Query) => boolean {
  const normalizedCwd = scope.cwd === undefined ? undefined : normalizeCheckoutCwd(scope.cwd);
  return (query) => {
    const key = query.queryKey;
    return (
      isCheckoutQueryKey(key) &&
      key[0] === queryKind &&
      key[1] === scope.serverId &&
      (normalizedCwd === undefined || normalizeCheckoutCwd(key[2]) === normalizedCwd)
    );
  };
}

function isCheckoutQueryKey(key: readonly unknown[]): key is CheckoutQueryKey {
  return (
    key.length >= 3 &&
    typeof key[0] === "string" &&
    typeof key[1] === "string" &&
    typeof key[2] === "string"
  );
}
