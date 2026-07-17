import type {
  ProjectConfigImportPreview,
  ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";

export type ProjectConfigImportAvailabilityStatus = "loading" | "none" | "one" | "many";

type ProjectConfigImportOpenablePreview =
  | ({ ok: true } & Pick<ProjectConfigImportPreview, "items" | "status">)
  | { ok: false; error: Pick<ProjectConfigRpcError, "code"> };

export function projectConfigImportAvailabilityStatus(input: {
  availableCount: number;
  isLoading: boolean;
}): ProjectConfigImportAvailabilityStatus {
  if (input.isLoading) {
    return "loading";
  }
  if (input.availableCount === 0) {
    return "none";
  }
  return input.availableCount === 1 ? "one" : "many";
}

export function projectConfigImportPreviewIsOpenable(
  preview: ProjectConfigImportOpenablePreview | null | undefined,
): boolean {
  if (!preview) {
    return false;
  }
  if (!preview.ok) {
    return preview.error.code === "invalid_source_config";
  }
  if (preview.status === "available") {
    return true;
  }
  if (preview.status === "nothing_to_import") {
    return preview.items.length > 0;
  }
  return false;
}
