import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";

export function useAttachmentPreviewUrl(
  attachment: AttachmentMetadata | null | undefined,
  onError?: (error: unknown) => void,
  retryVersion = 0,
): string | null {
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
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
        setPreview({ key: previewKey, url: resolved });
      } catch (error) {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (!disposed) {
          setPreview(null);
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

  // 元数据切换后绝不向新图片返回上一张已释放的 Blob URL。
  return preview?.key === previewKey ? preview.url : null;
}
