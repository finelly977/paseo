import type { ProjectConfigImportVisibleError } from "./project-config-import-sheet";

export type ProjectConfigImportRetryAction = "refresh" | "apply";

export function projectConfigImportApplyFailureRetryAction(
  error: ProjectConfigImportVisibleError,
): ProjectConfigImportRetryAction {
  return error.code === "stale_source_config" ||
    error.code === "stale_project_config" ||
    error.code === "nothing_to_import" ||
    error.code === "source_config_not_found" ||
    error.code === "invalid_source_config"
    ? "refresh"
    : "apply";
}
