import type { ProjectConfigImportSourceDescriptor } from ".";
import { conductorProjectConfigImportView } from "./conductor.view-registration";
import { createProjectConfigImportViewRegistry } from "./view-registry";
import type { ProjectConfigImportViewModule } from "./view-registry";
export type { ProjectConfigImportIconProps, ProjectConfigImportViewModule } from "./view-registry";

const PROJECT_CONFIG_IMPORT_VIEW_MODULES = [conductorProjectConfigImportView];

export const projectConfigImportViewRegistry = createProjectConfigImportViewRegistry(
  PROJECT_CONFIG_IMPORT_VIEW_MODULES,
);

export function getProjectConfigImportViewModule(
  source: ProjectConfigImportSourceDescriptor,
): ProjectConfigImportViewModule {
  return projectConfigImportViewRegistry.get(source);
}
