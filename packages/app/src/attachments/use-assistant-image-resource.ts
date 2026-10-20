import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useFetchQuery } from "@/data/query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata } from "./types";
import {
  assistantDataImageQueryOptions,
  assistantFileImageQueryOptions,
} from "./assistant-image-query";
import { parseImageDataUrl } from "./utils";
import { useAttachmentPreviewUrl } from "./use-attachment-preview-url";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";

type AssistantImageResourceState =
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "error"; error: unknown };

function useImageHostConnected(client: DaemonClient | null | undefined): boolean {
  const subscribe = useCallback(
    (listener: () => void) => (client ? client.subscribeConnectionStatus(listener) : () => {}),
    [client],
  );
  const snapshot = useCallback(() => client?.isConnected === true, [client]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useAssistantImageResource(input: {
  source: string;
  workspaceRoot?: string;
  serverId?: string;
  client?: DaemonClient | null;
}) {
  const { source, workspaceRoot, serverId, client } = input;
  const resolution = useMemo(
    () => resolveAssistantImageSource({ source, workspaceRoot }),
    [source, workspaceRoot],
  );
  const dataImage = useMemo(() => parseImageDataUrl(source), [source]);
  const connected = useImageHostConnected(client);
  const fileQuery = useFetchQuery({
    ...assistantFileImageQueryOptions({
      serverId,
      client,
      target: resolution?.kind === "file_rpc" ? resolution : null,
    }),
    enabled: connected && resolution?.kind === "file_rpc",
    dataShape: "value",
    staleTimeMs: 0,
  });
  const dataQuery = useFetchQuery({
    ...assistantDataImageQueryOptions({ source, dataImage }),
    dataShape: "value",
    staleTimeMs: 0,
  });
  const [retryVersion, setRetryVersion] = useState(0);
  const [previewFailure, setPreviewFailure] = useState<{
    attachment: AttachmentMetadata;
    error: unknown;
  } | null>(null);
  const filePreviewError = useCallback(
    (error: unknown) => {
      if (fileQuery.data) setPreviewFailure({ attachment: fileQuery.data, error });
    },
    [fileQuery.data],
  );
  const dataPreviewError = useCallback(
    (error: unknown) => {
      if (dataQuery.data) setPreviewFailure({ attachment: dataQuery.data, error });
    },
    [dataQuery.data],
  );
  const fileUri = useAttachmentPreviewUrl(fileQuery.data, filePreviewError, retryVersion);
  const dataUri = useAttachmentPreviewUrl(dataQuery.data, dataPreviewError, retryVersion);
  const query = dataImage ? dataQuery : fileQuery;
  const previewError =
    previewFailure && previewFailure.attachment === query.data ? previewFailure.error : null;
  const { isFetching, refetch } = query;
  const retry = useCallback(() => {
    if (isFetching) return;
    setPreviewFailure(null);
    if (dataImage || resolution?.kind === "file_rpc") {
      void refetch()
        .then((result) => {
          if (result.isSuccess) setRetryVersion((version) => version + 1);
          return undefined;
        })
        .catch((error) => console.error("[图片预览] 重试读取失败", { source, error }));
    } else setRetryVersion((version) => version + 1);
  }, [isFetching, refetch, dataImage, resolution, source]);
  const directUri = resolution?.kind === "direct" && !dataImage ? resolution.uri : null;
  const uri = directUri ?? dataUri ?? fileUri;
  const state = resolveImageResourceState({
    uri,
    query,
    previewError,
    waiting: resolution?.kind === "file_rpc" && !connected,
  });
  return { state, retryVersion, retry };
}

function resolveImageResourceState(input: {
  uri: string | null;
  query: {
    isFetching: boolean;
    isError: boolean;
    data: AttachmentMetadata | undefined;
    error: unknown;
  };
  previewError: unknown;
  waiting: boolean;
}): AssistantImageResourceState {
  const { uri, query, previewError, waiting } = input;
  if (uri && !query.isFetching) return { status: "ready", uri };
  if (waiting) return { status: "waiting" };
  if (query.isFetching || (query.data && !previewError && !query.isError))
    return { status: "loading" };
  return { status: "error", error: query.error ?? previewError };
}
