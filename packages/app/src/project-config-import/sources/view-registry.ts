import type { ComponentType } from "react";
import type { ProjectConfigImportSourceDescriptor } from ".";

export interface ProjectConfigImportIconProps {
  size?: number;
  color?: string;
}

export interface ProjectConfigImportViewModule {
  readonly kind: string;
  readonly Icon: ComponentType<ProjectConfigImportIconProps>;
}

export function createProjectConfigImportViewRegistry(
  modules: readonly ProjectConfigImportViewModule[],
) {
  const byKind = new Map<string, ProjectConfigImportViewModule>();
  for (const module of modules) {
    if (byKind.has(module.kind)) {
      throw new Error(`Duplicate project config import view: ${module.kind}`);
    }
    byKind.set(module.kind, module);
  }

  return {
    kinds(): string[] {
      return Array.from(byKind.keys());
    },
    get(source: ProjectConfigImportSourceDescriptor): ProjectConfigImportViewModule {
      const module = byKind.get(source.kind);
      if (!module) {
        throw new Error(`Missing project config import view: ${source.kind}`);
      }
      return module;
    },
  };
}
