import type { AgentUserMessageImage } from "@getpaseo/protocol/agent-types";
import type { AttachmentMetadata } from "@/attachments/types";
import { getRasterImageMimeTypeFromPath } from "@/attachments/file-types";
import { persistAttachmentFromFileUri } from "@/attachments/service";
import { createPreviewAttachmentId } from "@/attachments/utils";

const resolvedImages = new Map<string, Promise<AttachmentMetadata>>();

export function mergeResolvedProviderUserImages(
  existing: readonly AttachmentMetadata[],
  restored: readonly AttachmentMetadata[],
): AttachmentMetadata[] {
  const restoredById = new Map(restored.map((image) => [image.id, image]));
  const merged = existing.map((image) => restoredById.get(image.id) ?? image);
  const existingIds = new Set(existing.map((image) => image.id));
  for (const image of restored) {
    if (!existingIds.has(image.id)) {
      merged.push(image);
    }
  }
  return merged;
}

export function resolveProviderUserImage(
  image: AgentUserMessageImage,
): Promise<AttachmentMetadata> {
  const mimeType = image.mimeType ?? getRasterImageMimeTypeFromPath(image.path) ?? "image/jpeg";
  const key = `${image.path}\0${mimeType}`;
  const existing = resolvedImages.get(key);
  if (existing) {
    return existing;
  }

  const id = `provider_${createPreviewAttachmentId({ mimeType, path: image.path })}`;
  const pending = persistAttachmentFromFileUri({
    uri: image.path,
    mimeType,
    id,
  });
  const tracked = pending.finally(() => {
    resolvedImages.delete(key);
  });
  resolvedImages.set(key, tracked);
  return tracked;
}
