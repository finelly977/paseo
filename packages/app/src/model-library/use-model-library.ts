import { useFetchQuery } from "@/data/query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import {
  EMPTY_MODEL_LIBRARY,
  readModelLibrary,
  updateModelLibrary,
  type ModelLibraryPreferences,
} from "./preferences";

export function useModelLibrary(serverId: string | null) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["model-library", serverId];
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    queryKey: key,
    enabled: serverId !== null,
    queryFn: () => {
      if (!serverId) throw new Error("No host selected");
      return readModelLibrary(AsyncStorage, serverId);
    },
  });
  const mutation = useMutation({
    // 同一主机的收藏与排序串行写入，多处选择器共用查询缓存。
    scope: { id: `model-library:${serverId}` },
    mutationFn: (update: (current: ModelLibraryPreferences) => ModelLibraryPreferences) => {
      if (!serverId) throw new Error("No host selected");
      return updateModelLibrary(AsyncStorage, serverId, update);
    },
    onSuccess: (next) => queryClient.setQueryData(["model-library", serverId], next),
    onError: (error) => {
      console.error("[模型偏好] 保存失败", error);
      toast.error(`模型偏好保存失败：${error.message}`);
    },
  });
  const { mutate } = mutation;
  const save = useCallback(
    (update: (current: ModelLibraryPreferences) => ModelLibraryPreferences) => mutate(update),
    [mutate],
  );
  return {
    preferences: query.data ?? EMPTY_MODEL_LIBRARY,
    ready: query.isSuccess,
    busy: mutation.isPending,
    error: query.error,
    retry: query.refetch,
    save,
  };
}
export type ModelLibrary = ReturnType<typeof useModelLibrary>;
