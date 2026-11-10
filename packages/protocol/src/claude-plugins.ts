import { z } from "zod";

const PluginId = z.string().regex(/^\w[\w.-]*@\w[\w.-]*$/);
const Name = z
  .string()
  .trim()
  .regex(/^\w[\w.-]*$/);
export const ClaudePluginScopeSchema = z.enum(["user", "project", "local"]);
export type ClaudePluginScope = z.infer<typeof ClaudePluginScopeSchema>;
export const ClaudePluginSchema = z.object({
  id: PluginId,
  name: z.string(),
  title: z.string(),
  marketplaceName: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  installed: z.boolean(),
  enabled: z.boolean(),
  iconUrl: z.string().nullable(),
  iconUrlDark: z.string().nullable(),
  developer: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  capabilities: z.array(z.string()),
  errors: z.array(z.string()),
  installations: z.array(
    z.object({ scope: z.string(), projectPath: z.string().nullable(), version: z.string() }),
  ),
});
export type ClaudePlugin = z.infer<typeof ClaudePluginSchema>;
export const ClaudePluginCatalogSchema = z.object({
  plugins: z.array(ClaudePluginSchema),
  marketplaces: z.array(z.object({ name: z.string(), source: z.string() })),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export const ClaudePluginDetailSchema = z.object({
  plugin: ClaudePluginSchema,
  description: z.string(),
  readme: z.string().nullable(),
  contentStatus: z.enum(["available", "install_required"]),
  components: z.array(z.string()),
});
export const ClaudePluginActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("install"),
    pluginId: PluginId,
    scope: ClaudePluginScopeSchema,
    acceptCommand: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({ kind: z.literal("uninstall"), pluginId: PluginId, scope: ClaudePluginScopeSchema }),
  z.object({
    kind: z.literal("set_enabled"),
    pluginId: PluginId,
    scope: ClaudePluginScopeSchema,
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("update"),
    pluginId: PluginId,
    scope: ClaudePluginScopeSchema,
    acceptCommand: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.object({
    kind: z.literal("add_marketplace"),
    source: z.string().trim().min(1).max(2000),
    scope: ClaudePluginScopeSchema,
  }),
  z.object({ kind: z.literal("refresh_marketplace"), name: Name }),
  z.object({ kind: z.literal("remove_marketplace"), name: Name, scope: ClaudePluginScopeSchema }),
]);
export type ClaudePluginAction = z.infer<typeof ClaudePluginActionSchema>;
export const ClaudePluginActionResultSchema = z.object({
  restartRequired: z.boolean(),
  message: z.string(),
  confirmation: z
    .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), description: z.string() })
    .nullable(),
});
export const ClaudePluginCatalogRequestSchema = z.object({
  type: z.literal("claude.plugins.get_catalog.request"),
  requestId: z.string(),
  cwd: z.string().min(1).optional(),
  force: z.boolean(),
  query: z.string().max(300).optional(),
  installedOnly: z.boolean().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type ClaudePluginCatalogInput = Omit<
  z.infer<typeof ClaudePluginCatalogRequestSchema>,
  "type" | "requestId"
>;
export const ClaudePluginCatalogResponseSchema = z.object({
  type: z.literal("claude.plugins.get_catalog.response"),
  payload: z.object({ requestId: z.string(), catalog: ClaudePluginCatalogSchema }),
});
export const ClaudePluginDetailRequestSchema = z.object({
  type: z.literal("claude.plugins.get_detail.request"),
  requestId: z.string(),
  pluginId: PluginId,
  cwd: z.string().min(1).optional(),
});
export const ClaudePluginDetailResponseSchema = z.object({
  type: z.literal("claude.plugins.get_detail.response"),
  payload: z.object({ requestId: z.string(), detail: ClaudePluginDetailSchema }),
});
export const ClaudePluginManageRequestSchema = z.object({
  type: z.literal("claude.plugins.manage.request"),
  requestId: z.string(),
  action: ClaudePluginActionSchema,
  cwd: z.string().min(1).optional(),
});
export const ClaudePluginManageResponseSchema = z.object({
  type: z.literal("claude.plugins.manage.response"),
  payload: z.object({ requestId: z.string(), result: ClaudePluginActionResultSchema }),
});
export interface ClaudePluginService {
  catalog(input: ClaudePluginCatalogInput): Promise<z.infer<typeof ClaudePluginCatalogSchema>>;
  detail(pluginId: string, cwd?: string): Promise<z.infer<typeof ClaudePluginDetailSchema>>;
  manage(
    action: ClaudePluginAction,
    cwd?: string,
  ): Promise<z.infer<typeof ClaudePluginActionResultSchema>>;
}
