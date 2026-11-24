import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";

export interface AttachmentImageSize {
  width: number;
  height: number;
}

export type AttachmentPreviewStatus = "idle" | "loading" | "ready" | "error";

export interface AttachmentPreviewState {
  url: string | null;
  status: AttachmentPreviewStatus;
}

const MAX_CACHED_IMAGE_SIZES = 200;
const attachmentImageSizeCache = new Map<string, AttachmentImageSize>();

export function rememberAttachmentImageSize(attachmentId: string, size: AttachmentImageSize): void {
  if (
    !attachmentId ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return;
  }
  if (attachmentImageSizeCache.has(attachmentId)) {
    attachmentImageSizeCache.delete(attachmentId);
  } else if (attachmentImageSizeCache.size >= MAX_CACHED_IMAGE_SIZES) {
    const oldestKey = attachmentImageSizeCache.keys().next().value;
    if (oldestKey !== undefined) {
      attachmentImageSizeCache.delete(oldestKey);
    }
  }
  attachmentImageSizeCache.set(attachmentId, size);
}

export function getCachedAttachmentImageSize(
  attachmentId: string | null | undefined,
): AttachmentImageSize | undefined {
  if (!attachmentId) {
    return undefined;
  }
  return attachmentImageSizeCache.get(attachmentId);
}

export function useAttachmentPreviewState(
  attachment: AttachmentMetadata | null | undefined,
  onError?: (error: unknown) => void,
  retryVersion = 0,
): AttachmentPreviewState {
  const [preview, setPreview] = useState<{
    key: string;
    url: string | null;
    status: "ready" | "error";
  } | null>(null);
  const attachmentRef = useRef(attachment);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  attachmentRef.current = attachment;

  const id = attachment?.id;
  const storageType = attachment?.storageType;
  const storageKey = attachment?.storageKey;
  const mimeType = attachment?.mimeType;
  const createdAt = attachment?.createdAt;
  const previewKey = JSON.stringify([
    id,
    storageType,
    storageKey,
    mimeType,
    createdAt,
    retryVersion,
  ]);

  useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;
    const current = attachmentRef.current;

    if (!current) {
      setPreview(null);
      return;
    }

    void (async () => {
      try {
        const resolved = await resolveAttachmentPreviewUrl(current);
        if (disposed) {
          await releaseAttachmentPreviewUrl({ attachment: current, url: resolved });
          return;
        }
        currentUrl = resolved;
        setPreview({ key: previewKey, url: resolved, status: "ready" });
      } catch (error) {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (!disposed) {
          setPreview({ key: previewKey, url: null, status: "error" });
          onErrorRef.current?.(error);
        }
      }
    })();

    return () => {
      disposed = true;
      if (!currentUrl) {
        return;
      }
      void releaseAttachmentPreviewUrl({
        attachment: current,
        url: currentUrl,
      }).catch((error) => {
        console.error("[附件] 释放图片预览失败", { attachmentId: current.id, error });
      });
    };
  }, [previewKey]);

  if (!attachment) {
    return { url: null, status: "idle" };
  }
  // 元数据切换后绝不向新图片返回上一张已释放的 Blob URL。
  if (preview?.key !== previewKey) {
    return { url: null, status: "loading" };
  }
  return { url: preview.url, status: preview.status };
}

export function useAttachmentPreviewUrl(
  attachment: AttachmentMetadata | null | undefined,
  onError?: (error: unknown) => void,
  retryVersion = 0,
): string | null {
  return useAttachmentPreviewState(attachment, onError, retryVersion).url;
}
