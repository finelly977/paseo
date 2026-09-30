import type { ExplorerFile } from "@/stores/session-store";
import type { FileVersion } from "@getpaseo/protocol/messages";
import { MAX_EDITABLE_FILE_BYTES } from "@getpaseo/protocol/workspace-file-limits";

export type FileReadonlyReason = "platform" | "host" | "type" | "size" | "permission";

export function filePreviewReadonlyReason(input: {
  preview: ExplorerFile | null;
  version: FileVersion | null;
  supportsEditing: boolean;
  web: boolean;
}): FileReadonlyReason | null {
  if (!input.preview) return null;
  const writeAccess = input.version?.status === "ready" ? input.version.writeAccess : undefined;
  return fileReadonlyReason({
    web: input.web,
    supportsEditing: input.supportsEditing,
    kind: input.preview.kind,
    size: input.preview.size,
    writeAccess,
  });
}

export function fileReadonlyReason(input: {
  web: boolean;
  supportsEditing: boolean;
  kind: "text" | "image" | "binary";
  size: number;
  writeAccess: "allowed" | "denied" | undefined;
}): FileReadonlyReason | null {
  if (input.kind !== "text") return "type";
  if (!input.web) return "platform";
  if (!input.supportsEditing) return "host";
  if (input.size > MAX_EDITABLE_FILE_BYTES) return "size";
  if (input.writeAccess === "denied") return "permission";
  return null;
}
