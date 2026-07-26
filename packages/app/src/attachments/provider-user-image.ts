import type { AgentUserMessageImage } from "@getpaseo/protocol/agent-types";
import type { AttachmentMetadata } from "@/attachments/types";
import { getRasterImageMimeTypeFromPath } from "@/attachments/file-types";
import { persistAttachmentFromFileUri } from "@/attachments/service";

const resolvedImages = new Map<string, Promise<AttachmentMetadata>>();

export function resolveProviderUserImage(
  image: AgentUserMessageImage,
): Promise<AttachmentMetadata> {
  const key = `${image.path}\0${image.mimeType ?? ""}`;
  const existing = resolvedImages.get(key);
  if (existing) {
    return existing;
  }

  const pending = persistAttachmentFromFileUri({
    uri: image.path,
    mimeType: image.mimeType ?? getRasterImageMimeTypeFromPath(image.path) ?? "image/jpeg",
  }).catch((error) => {
    resolvedImages.delete(key);
    throw error;
  });
  resolvedImages.set(key, pending);
  return pending;
}
