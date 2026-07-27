import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useQueries,
  useQuery,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

type QueryFnOption<TQueryFnData, TError, TData, TQueryKey extends QueryKey> = NonNullable<
  UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>["queryFn"]
>;

type ReplicaQueryInput<TQueryFnData, TError, TData, TQueryKey extends QueryKey> = Omit<
  UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  | "gcTime"
  | "initialData"
  | "refetchOnMount"
  | "refetchOnReconnect"
  | "refetchOnWindowFocus"
  | "staleTime"
> & {
  pushEvent: string;
};

type FetchQueryInput<TQueryFnData, TError, TData, TQueryKey extends QueryKey> = Omit<
  UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  "initialData" | "placeholderData" | "queryFn" | "refetchOnMount" | "staleTime"
> & {
  dataShape: "list" | "value";
  queryFn: QueryFnOption<TQueryFnData, TError, TData, TQueryKey>;
  staleTimeMs: number;
};

type InfiniteFetchQueryInput<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey,
  TPageParam,
> = Omit<
  UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
  "initialData" | "placeholderData" | "refetchOnMount" | "staleTime"
> & {
  dataShape: "list" | "value";
  staleTimeMs: number;
};

export function useReplicaQuery<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(input: ReplicaQueryInput<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData, TError> {
  return useQuery(replicaQueryOptions(input));
}

export function useFetchQuery<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(input: FetchQueryInput<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData, TError> {
  return useQuery(fetchQueryOptions(input));
}

export function useFetchQueries<TData>(
  inputs: FetchQueryInput<TData, Error, TData, QueryKey>[],
): UseQueryResult<TData, Error>[] {
  return useQueries({ queries: inputs.map((input) => fetchQueryOptions(input)) });
}

export function useInfiniteFetchQuery<
  TQueryFnData,
  TError = Error,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  input: InfiniteFetchQueryInput<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
): UseInfiniteQueryResult<TData, TError> {
  if (!Number.isFinite(input.staleTimeMs)) {
    throw new Error("无限查询必须声明有限的过期时间");
  }

  const { dataShape, meta, staleTimeMs, ...options } = input;
  return useInfiniteQuery({
    ...options,
    ...(dataShape === "list" ? { placeholderData: keepPreviousData } : {}),
    meta: {
      ...meta,
      serverDataPolicy: {
        class: "fetch",
        dataShape,
      },
    },
    refetchOnMount: "always",
    staleTime: staleTimeMs,
  });
}

function replicaQueryOptions<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  input: ReplicaQueryInput<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryOptions<TQueryFnData, TError, TData, TQueryKey> {
  const { pushEvent, meta, ...options } = input;
  return {
    ...options,
    gcTime: Infinity,
    meta: {
      ...meta,
      serverDataPolicy: {
        class: "replica",
        pushEvent,
      },
    },
    queryFn: options.queryFn ?? skipToken,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  };
}

function fetchQueryOptions<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  input: FetchQueryInput<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryOptions<TQueryFnData, TError, TData, TQueryKey> {
  if (!Number.isFinite(input.staleTimeMs)) {
    throw new Error("Fetch queries must declare a finite staleTimeMs.");
  }

  const { dataShape, meta, staleTimeMs, ...options } = input;
  return {
    ...options,
    ...(dataShape === "list" ? { placeholderData: keepPreviousData } : {}),
    meta: {
      ...meta,
      serverDataPolicy: {
        class: "fetch",
        dataShape,
      },
    },
    refetchOnMount: "always",
    staleTime: staleTimeMs,
  };
}
