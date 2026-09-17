import type { AgentUserMessageImage } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata } from "@/attachments/types";
import { getRasterImageMimeTypeFromPath } from "@/attachments/file-types";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";

const resolvedImages = new Map<string, Promise<AttachmentMetadata>>();

type ProviderUserImageClient = Pick<DaemonClient, "readFile">;

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

export function resolveProviderUserImage(input: {
  image: AgentUserMessageImage;
  serverId: string;
  client: ProviderUserImageClient;
}): Promise<AttachmentMetadata> {
  const { image, serverId, client } = input;
  const mimeType = image.mimeType ?? getRasterImageMimeTypeFromPath(image.path) ?? "image/jpeg";
  const key = `${serverId}\0${image.path}\0${mimeType}`;
  const existing = resolvedImages.get(key);
  if (existing) {
    return existing;
  }

  const id = `provider_${createPreviewAttachmentId({ mimeType, path: key })}`;
  const pending = client.readFile(image.path, ".").then((file) =>
    persistAttachmentFromBytes({
      bytes: file.bytes,
      mimeType,
      fileName: getFileNameFromPath(image.path),
      id,
    }),
  );
  const tracked = pending.finally(() => {
    resolvedImages.delete(key);
  });
  resolvedImages.set(key, tracked);
  return tracked;
}
