import { ProjectConfigImportSourceSchema } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportSource } from "@getpaseo/protocol/messages";
import { conductorProjectConfigImportSource } from "./conductor";

export interface ProjectConfigImportSourceDescriptor {
  kind: string;
  [key: string]: unknown;
}

export interface ProjectConfigImportLogicModule<
  TSource extends ProjectConfigImportSourceDescriptor = ProjectConfigImportSourceDescriptor,
> {
  readonly kind: TSource["kind"];
  readonly source: TSource;
  readonly displayName: string;
  readonly routeValue: string;
}

export interface ProjectConfigImportSourceRegistration<
  TSource extends ProjectConfigImportSourceDescriptor = ProjectConfigImportSourceDescriptor,
> {
  readonly kind: string;
  readonly source: TSource;
  readonly protocolSource: ProjectConfigImportSource | null;
  readonly module: ProjectConfigImportLogicModule;
}

const PROJECT_CONFIG_IMPORT_LOGIC_MODULES = [conductorProjectConfigImportSource];

export const projectConfigImportSourceRegistry = createProjectConfigImportSourceRegistry(
  PROJECT_CONFIG_IMPORT_LOGIC_MODULES,
);

export type ProjectConfigImportSourceRegistry = ReturnType<
  typeof createProjectConfigImportSourceRegistry
>;

export function createProjectConfigImportSourceRegistry<
  const TModules extends readonly ProjectConfigImportLogicModule[],
>(modules: TModules) {
  const byKind = new Map<string, ProjectConfigImportLogicModule>();
  const byRouteValue = new Map<string, ProjectConfigImportLogicModule>();

  for (const module of modules) {
    if (byKind.has(module.kind)) {
      throw new Error(`Duplicate project config import source: ${module.kind}`);
    }
    if (byRouteValue.has(module.routeValue)) {
      throw new Error(`Duplicate project config import route value: ${module.routeValue}`);
    }
    byKind.set(module.kind, module);
    byRouteValue.set(module.routeValue, module);
  }

  return {
    all(): ProjectConfigImportLogicModule[] {
      return Array.from(byKind.values());
    },
    get(source: ProjectConfigImportSourceDescriptor): ProjectConfigImportLogicModule | null {
      return byKind.get(source.kind) ?? null;
    },
    fromRouteValue(routeValue: string): ProjectConfigImportLogicModule | null {
      return byRouteValue.get(routeValue) ?? null;
    },
    routeValue(source: ProjectConfigImportSourceDescriptor): string | null {
      return byKind.get(source.kind)?.routeValue ?? null;
    },
    assertProtocolCoverage(): void {
      const missing = readProtocolSourceKinds().filter((kind) => !byKind.has(kind));
      if (missing.length > 0) {
        throw new Error(`Missing project config import sources: ${missing.join(", ")}`);
      }
    },
    advertised(
      sources: readonly ProjectConfigImportSourceDescriptor[] | null | undefined,
    ): ProjectConfigImportSourceRegistration[] {
      if (!sources) {
        return [];
      }
      return sources
        .map((source) => {
          const module = byKind.get(source.kind);
          return module
            ? {
                kind: source.kind,
                source,
                protocolSource: toProjectConfigImportProtocolSource(source),
                module,
              }
            : null;
        })
        .filter((source): source is ProjectConfigImportSourceRegistration => source !== null);
    },
  };
}

export function toProjectConfigImportProtocolSource(
  source: ProjectConfigImportSourceDescriptor,
): ProjectConfigImportSource | null {
  const parsed = ProjectConfigImportSourceSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

function readProtocolSourceKinds(): string[] {
  return ProjectConfigImportSourceSchema.options.map((option) => option.shape.kind.value);
}
