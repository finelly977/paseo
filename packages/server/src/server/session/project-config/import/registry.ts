import { ProjectConfigImportSourceSchema } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportSource } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportCandidate } from "./service.js";
import { conductorProjectConfigImporter } from "./sources/conductor/importer.js";

const PROJECT_CONFIG_IMPORT_ADAPTERS = [conductorProjectConfigImporter];

export interface ProjectConfigImportAdapter<
  TSource extends { kind: string } = ProjectConfigImportSource,
> {
  readonly source: { kind: string; [key: string]: unknown };
  inspect(input: { repoRoot: string; source: TSource }): ProjectConfigImportCandidate | null;
}

export interface ProjectConfigImportSourceSet<TSource extends { kind: string }> {
  parse(source: { kind: string; [key: string]: unknown }): TSource | null;
  kinds(): readonly TSource["kind"][];
}

export interface ProjectConfigImportRegistry<
  TSource extends { kind: string } = ProjectConfigImportSource,
> {
  get(kind: TSource["kind"]): ProjectConfigImportAdapter<TSource> | null;
  sources(): TSource[];
  assertProtocolCoverage(): void;
}

export function createProjectConfigImportRegistry<TSource extends { kind: string }>(
  adapters: readonly ProjectConfigImportAdapter<TSource>[],
  sourceSet: ProjectConfigImportSourceSet<TSource>,
) {
  const byKind = new Map<TSource["kind"], ProjectConfigImportAdapter<TSource>>();
  for (const adapter of adapters) {
    const source = sourceSet.parse(adapter.source);
    if (!source) {
      throw new Error(`Unknown project config import adapter: ${adapter.source.kind}`);
    }
    const kind = source.kind;
    if (byKind.has(kind)) {
      throw new Error(`Duplicate project config import adapter: ${adapter.source.kind}`);
    }
    byKind.set(kind, adapter);
  }

  return {
    get(kind: TSource["kind"]): ProjectConfigImportAdapter<TSource> | null {
      return byKind.get(kind) ?? null;
    },
    sources(): TSource[] {
      return Array.from(byKind.values()).map((adapter) => sourceSet.parse(adapter.source)!);
    },
    assertProtocolCoverage(): void {
      const missing = sourceSet.kinds().filter((kind) => !byKind.has(kind));
      if (missing.length > 0) {
        throw new Error(`Missing project config import adapters: ${missing.join(", ")}`);
      }
    },
  } satisfies ProjectConfigImportRegistry<TSource>;
}

export const productionProjectConfigImportSourceSet = {
  parse(source: { kind: string; [key: string]: unknown }): ProjectConfigImportSource | null {
    const parsed = ProjectConfigImportSourceSchema.safeParse(source);
    return parsed.success ? parsed.data : null;
  },
  kinds: readProtocolSourceKinds,
} satisfies ProjectConfigImportSourceSet<ProjectConfigImportSource>;

export const projectConfigImportRegistry = createProjectConfigImportRegistry(
  PROJECT_CONFIG_IMPORT_ADAPTERS,
  productionProjectConfigImportSourceSet,
);

function readProtocolSourceKinds(): ProjectConfigImportSource["kind"][] {
  const options = ProjectConfigImportSourceSchema.options;
  return options.map((option) => option.shape.kind.value);
}
