import { z } from "zod";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const PaseoLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const PaseoScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const PaseoWorktreeConfigRawSchema = z
  .object({
    setup: PaseoLifecycleCommandRawSchema.optional(),
    teardown: PaseoLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const PaseoMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const PaseoMetadataGenerationSchema = z
  .object({
    title: PaseoMetadataGenerationEntrySchema.optional(),
    branchName: PaseoMetadataGenerationEntrySchema.optional(),
    commitMessage: PaseoMetadataGenerationEntrySchema.optional(),
    pullRequest: PaseoMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy paseo.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const PaseoConfigRawSchema = z
  .object({
    worktree: PaseoWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), PaseoScriptEntryRawSchema).optional(),
    metadataGeneration: PaseoMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = PaseoWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = PaseoScriptEntryRawSchema.catch({});

export const PaseoConfigSchema = PaseoConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: PaseoMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const PaseoConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigImportSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conductor") }),
]);

export const ProjectConfigImportAdvertisedSourceSchema = z
  .object({ kind: z.string().min(1) })
  .passthrough();

export const ProjectConfigImportInputSchema = z.object({
  role: z.string(),
  relativePath: z.string(),
});

export const ProjectConfigImportItemOutcomeSchema = z.enum([
  "import",
  "rewrite",
  "collision",
  "unsupported",
]);

export const ProjectConfigImportItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  outcome: ProjectConfigImportItemOutcomeSchema,
  detail: z.string().optional(),
});

export const ProjectConfigImportStatusSchema = z.enum([
  "available",
  "not_found",
  "nothing_to_import",
]);

export const ProjectConfigImportPreviewSchema = z.object({
  repoRoot: z.string(),
  source: ProjectConfigImportSourceSchema,
  status: ProjectConfigImportStatusSchema,
  sourceRevision: z.string().nullable(),
  paseoRevision: PaseoConfigRevisionSchema.nullable(),
  inputs: z.array(ProjectConfigImportInputSchema),
  items: z.array(ProjectConfigImportItemSchema),
  preview: PaseoConfigRawSchema.nullable(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({
    code: z.literal("source_config_not_found"),
    source: ProjectConfigImportSourceSchema,
  }),
  z.object({
    code: z.literal("invalid_source_config"),
    source: ProjectConfigImportSourceSchema,
    relativePath: z.string(),
  }),
  z.object({
    code: z.literal("stale_source_config"),
    source: ProjectConfigImportSourceSchema,
  }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: PaseoConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("nothing_to_import") }),
  z.object({ code: z.literal("write_failed") }),
]);

export type PaseoScriptEntryRaw = z.infer<typeof PaseoScriptEntryRawSchema>;
export type PaseoMetadataGenerationEntry = z.infer<typeof PaseoMetadataGenerationEntrySchema>;
export type PaseoMetadataGeneration = z.infer<typeof PaseoMetadataGenerationSchema>;
export type PaseoConfigRaw = z.infer<typeof PaseoConfigRawSchema>;
export type PaseoConfig = z.infer<typeof PaseoConfigSchema>;
export type PaseoConfigRevision = z.infer<typeof PaseoConfigRevisionSchema>;
export type ProjectConfigImportSource = z.infer<typeof ProjectConfigImportSourceSchema>;
export type ProjectConfigImportAdvertisedSource = z.infer<
  typeof ProjectConfigImportAdvertisedSourceSchema
>;
export type ProjectConfigImportInput = z.infer<typeof ProjectConfigImportInputSchema>;
export type ProjectConfigImportItem = z.infer<typeof ProjectConfigImportItemSchema>;
export type ProjectConfigImportPreview = z.infer<typeof ProjectConfigImportPreviewSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
