import { z } from "zod";

const NameSchema = z.string().trim().min(1).max(200);
const PluginIdSchema = z.string().regex(/^[\w.-]+@[\w.-]+$/);

export const CodexPluginSchema = z.object({
  id: PluginIdSchema,
  name: NameSchema,
  title: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  installed: z.boolean(),
  enabled: z.boolean(),
  installPolicy: z.enum(["AVAILABLE", "NOT_AVAILABLE", "INSTALLED_BY_DEFAULT"]),
  authPolicy: z.enum(["ON_INSTALL", "ON_USE"]),
  disabledReason: z.string().nullable(),
  iconUrl: z.string().nullable(),
  iconUrlDark: z.string().nullable(),
  developer: z.string().nullable(),
  category: z.string().nullable(),
  websiteUrl: z.string().url().nullable(),
  privacyPolicyUrl: z.string().url().nullable(),
  termsOfServiceUrl: z.string().url().nullable(),
  capabilities: z.array(z.string()),
});
export type CodexPlugin = z.infer<typeof CodexPluginSchema>;

export const CodexMarketplaceSchema = z.object({
  name: NameSchema,
  title: z.string(),
  path: z.string().nullable(),
  plugins: z.array(CodexPluginSchema),
});
export type CodexMarketplace = z.infer<typeof CodexMarketplaceSchema>;

export const CodexPluginCatalogSchema = z.object({
  marketplaces: z.array(CodexMarketplaceSchema),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type CodexPluginCatalog = z.infer<typeof CodexPluginCatalogSchema>;

export const CodexPluginActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("install"),
    marketplaceName: NameSchema,
    marketplacePath: z.string().nullable(),
    pluginName: NameSchema,
  }),
  z.object({ kind: z.literal("uninstall"), pluginId: PluginIdSchema }),
  z.object({ kind: z.literal("set_enabled"), pluginId: PluginIdSchema, enabled: z.boolean() }),
  z.object({
    kind: z.literal("add_marketplace"),
    source: z.string().trim().min(1),
    ref: z.string().trim().min(1).optional(),
    sparsePaths: z.array(z.string().trim().min(1)).optional(),
  }),
  z.object({ kind: z.literal("refresh_marketplace"), name: NameSchema.optional() }),
  z.object({ kind: z.literal("remove_marketplace"), name: NameSchema }),
]);
export type CodexPluginAction = z.infer<typeof CodexPluginActionSchema>;

export const CodexPluginActionResultSchema = z.object({
  authApps: z.array(z.object({ name: z.string(), url: z.string().nullable() })),
  restartRequired: z.boolean(),
});
export type CodexPluginActionResult = z.infer<typeof CodexPluginActionResultSchema>;

export const CodexPluginTargetSchema = z.object({
  marketplaceName: NameSchema,
  marketplacePath: z.string().nullable(),
  pluginName: NameSchema,
});
export type CodexPluginTarget = z.infer<typeof CodexPluginTargetSchema>;
export const CodexPluginDetailSchema = z.object({
  plugin: CodexPluginSchema,
  description: z.string(),
  apps: z.array(
    z.object({ name: z.string(), description: z.string().nullable(), url: z.string().nullable() }),
  ),
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
  mcpServers: z.array(z.string()),
});
export type CodexPluginDetail = z.infer<typeof CodexPluginDetailSchema>;

export interface CodexPluginService {
  catalog(input: CodexPluginCatalogInput): Promise<CodexPluginCatalog>;
  manage(action: CodexPluginAction): Promise<CodexPluginActionResult>;
  detail(target: CodexPluginTarget): Promise<CodexPluginDetail>;
}

export const CodexPluginCatalogRequestSchema = z.object({
  type: z.literal("codex.plugins.get_catalog.request"),
  requestId: z.string(),
  scope: z.enum(["local", "official", "installed"]),
  force: z.boolean(),
  query: z.string().max(300).optional(),
  installedOnly: z.boolean().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type CodexPluginCatalogInput = Omit<
  z.infer<typeof CodexPluginCatalogRequestSchema>,
  "type" | "requestId"
>;
export const CodexPluginCatalogResponseSchema = z.object({
  type: z.literal("codex.plugins.get_catalog.response"),
  payload: z.object({ requestId: z.string(), catalog: CodexPluginCatalogSchema }),
});
export const CodexPluginManageRequestSchema = z.object({
  type: z.literal("codex.plugins.manage.request"),
  requestId: z.string(),
  action: CodexPluginActionSchema,
});
export const CodexPluginManageResponseSchema = z.object({
  type: z.literal("codex.plugins.manage.response"),
  payload: z.object({ requestId: z.string(), result: CodexPluginActionResultSchema }),
});

export const CodexPluginDetailRequestSchema = z.object({
  type: z.literal("codex.plugins.get_detail.request"),
  requestId: z.string(),
  target: CodexPluginTargetSchema,
});
export const CodexPluginDetailResponseSchema = z.object({
  type: z.literal("codex.plugins.get_detail.response"),
  payload: z.object({ requestId: z.string(), detail: CodexPluginDetailSchema }),
});
