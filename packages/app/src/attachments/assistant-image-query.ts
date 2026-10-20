import type { QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { FilePreviewReadTarget } from "@/file-explorer/preview-target";
import { persistAttachmentFromBytes, persistAttachmentFromDataUrl } from "./service";
import { createPreviewAttachmentId, getFileNameFromPath, type parseImageDataUrl } from "./utils";

export function assistantFileImageQueryOptions(input: {
  serverId?: string;
  client: Pick<DaemonClient, "readFile"> | null | undefined;
  target: FilePreviewReadTarget | null;
}) {
  const { client, target, serverId } = input;
  const attachmentId = createPreviewAttachmentId({
    mimeType: "image/*",
    path: JSON.stringify([serverId, target?.cwd, target?.path]),
  });
  return {
    queryKey: ["assistantMarkdownImage", serverId, target?.cwd, target?.path],
    enabled: client !== null && client !== undefined && target !== null,
    // 本地缓存可能被系统回收；每次重新挂载或连接恢复都从所属主机核对。
    staleTime: 0,
    refetchOnMount: "always" as const,
    meta: { assistantImageAttachmentId: attachmentId },
    queryFn: async () => {
      if (!client || !target) throw new Error("图片所属主机或文件地址不可用");
      const file = await client.readFile(target.cwd, target.path);
      if (file.kind !== "image") throw new Error("该文件不是可预览的图片");
      return persistAttachmentFromBytes({
        id: attachmentId,
        bytes: file.bytes,
        mimeType: file.mime,
        fileName: getFileNameFromPath(file.path || target.path),
      });
    },
  };
}

export function assistantDataImageQueryOptions(input: {
  source: string;
  dataImage: ReturnType<typeof parseImageDataUrl>;
}) {
  const { source, dataImage } = input;
  const attachmentId = createPreviewAttachmentId({
    mimeType: dataImage?.mimeType ?? "image/*",
    path: dataImage?.cacheKey,
  });
  return {
    queryKey: ["assistantMarkdownDataImage", dataImage?.cacheKey],
    enabled: dataImage !== null,
    staleTime: 0,
    refetchOnMount: "always" as const,
    meta: { assistantImageAttachmentId: attachmentId },
    queryFn: async () => {
      if (!dataImage) throw new Error("内嵌图片数据不可用");
      return persistAttachmentFromDataUrl({
        id: attachmentId,
        dataUrl: source,
        mimeType: dataImage.mimeType,
      });
    },
  };
}

export function collectAssistantImageAttachmentIds(
  client: QueryClient,
  referencedIds: Set<string>,
): void {
  // 查询是预览副本的所有者，包含正在写入但尚未返回元数据的请求。
  // 缓存过期移除后自然释放引用，不把整个历史的图片永久保存在客户端。
  for (const query of client.getQueryCache().getAll()) {
    const id = query.meta?.assistantImageAttachmentId;
    if (typeof id === "string") referencedIds.add(id);
  }
}
