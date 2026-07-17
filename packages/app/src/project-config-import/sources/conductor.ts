import type { ProjectConfigImportLogicModule } from ".";

export const conductorProjectConfigImportSource = {
  kind: "conductor",
  source: { kind: "conductor" },
  displayName: "Conductor",
  routeValue: "conductor",
} satisfies ProjectConfigImportLogicModule<{ kind: "conductor" }>;
