export type ProjectConfigImportAvailabilityStatus = "loading" | "none" | "one" | "many";

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
  preview: { ok: true; status: string } | { ok: false; error: { code: string } } | null | undefined,
): boolean {
  return preview?.ok === true
    ? preview.status === "available"
    : preview?.error.code === "invalid_source_config";
}
