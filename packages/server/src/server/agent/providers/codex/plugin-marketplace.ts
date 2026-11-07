import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import pLimit from "p-limit";
import {
  CodexPluginCatalogSchema,
  type CodexPluginAction,
  type CodexPluginActionResult,
  type CodexPluginCatalog,
  type CodexPluginCatalogInput,
  type CodexPluginService,
  type CodexPlugin,
} from "@getpaseo/protocol/codex-plugins";
import { CodexAppServerClient } from "./app-server-transport.js";

const READ_TIMEOUT_MS = 45_000;
const WRITE_TIMEOUT_MS = 120_000;
const InterfaceSchema = z.object({
  logo: z.string().nullish(),
  logoDark: z.string().nullish(),
  composerIcon: z.string().nullish(),
  displayName: z.string().nullish(),
  logoUrl: z.string().url().nullish(),
  logoUrlDark: z.string().url().nullish(),
  developerName: z.string().nullish(),
  category: z.string().nullish(),
  websiteUrl: z.string().url().nullish(),
  privacyPolicyUrl: z.string().url().nullish(),
  termsOfServiceUrl: z.string().url().nullish(),
  capabilities: z.array(z.string()).nullish(),
  shortDescription: z.string().nullish(),
  longDescription: z.string().nullish(),
});
const NativePluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  installed: z.boolean(),
  enabled: z.boolean(),
  installPolicy: z.enum(["AVAILABLE", "NOT_AVAILABLE", "INSTALLED_BY_DEFAULT"]),
  authPolicy: z.enum(["ON_INSTALL", "ON_USE"]),
  interface: InterfaceSchema.nullish(),
  version: z.string().nullish(),
  localVersion: z.string().nullish(),
  disabledReason: z.string().nullish(),
  availability: z.enum(["AVAILABLE", "DISABLED_BY_ADMIN"]).optional(),
});
const NativeCatalogSchema = z.object({
  marketplaces: z.array(
    z.object({
      name: z.string(),
      path: z.string().nullable(),
      interface: InterfaceSchema.nullish(),
      plugins: z.array(NativePluginSchema),
    }),
  ),
  marketplaceLoadErrors: z.array(z.object({ marketplacePath: z.string(), message: z.string() })),
});
const DetailSchema = z.object({
  plugin: z.object({
    summary: NativePluginSchema,
    description: z.string().nullish(),
    apps: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullish(),
        installUrl: z.string().nullish(),
      }),
    ),
    skills: z.array(z.object({ name: z.string(), description: z.string() })),
    mcpServers: z.array(z.string()),
  }),
});

async function readIcon(file: string | null | undefined): Promise<string | null> {
  if (!file) return null;
  const mime = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
  ]).get(path.extname(file).toLowerCase());
  if (!mime) return null;
  const meta = await stat(file);
  if (!meta.isFile() || meta.size > 512 * 1024) return null;
  const bytes = await readFile(file);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function toPlugin(plugin: z.infer<typeof NativePluginSchema>): Promise<CodexPlugin> {
  const ui = plugin.interface;
  return {
    id: plugin.id,
    name: plugin.name,
    title: ui?.displayName ?? plugin.name,
    description: ui?.shortDescription ?? ui?.longDescription ?? "",
    version: plugin.localVersion ?? plugin.version ?? null,
    installed: plugin.installed,
    enabled: plugin.enabled,
    installPolicy: plugin.installPolicy,
    authPolicy: plugin.authPolicy,
    disabledReason:
      plugin.disabledReason ??
      (plugin.availability === "DISABLED_BY_ADMIN" ? "disabled_by_admin" : null),
    iconUrl: ui?.logoUrl ?? (await readIcon(ui?.logo ?? ui?.composerIcon)),
    iconUrlDark: ui?.logoUrlDark ?? (await readIcon(ui?.logoDark)),
    ...pluginMetadata(ui),
  };
}

function pluginMetadata(ui: z.infer<typeof InterfaceSchema> | null | undefined) {
  return {
    developer: ui?.developerName ?? null,
    category: ui?.category ?? null,
    websiteUrl: ui?.websiteUrl ?? null,
    privacyPolicyUrl: ui?.privacyPolicyUrl ?? null,
    termsOfServiceUrl: ui?.termsOfServiceUrl ?? null,
    capabilities: ui?.capabilities ?? [],
  };
}

const InstallResultSchema = z.object({
  appsNeedingAuth: z.array(z.object({ name: z.string(), installUrl: z.string().nullable() })),
});

interface MarketplaceOptions {
  openClient(): Promise<CodexAppServerClient>;
}

export function createCodexPluginMarketplaceService(
  options: MarketplaceOptions,
): CodexPluginService {
  const reads = new Map<string, Promise<CodexPluginCatalog>>();
  const cache = new Map<string, { data: CodexPluginCatalog; expires: number }>();
  const mutations = pLimit(1);
  let generation = 0;

  async function withClient<T>(run: (client: CodexAppServerClient) => Promise<T>): Promise<T> {
    const client = await options.openClient();
    try {
      await client.request(
        "initialize",
        {
          clientInfo: { name: "paseo", title: "Paseo 插件市场", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        },
        READ_TIMEOUT_MS,
      );
      client.notify("initialized", {});
      return await run(client);
    } finally {
      await client.dispose();
    }
  }

  async function loadCatalog(input: {
    scope: "local" | "official" | "installed";
    force: boolean;
  }): Promise<CodexPluginCatalog> {
    return withClient(async (client) => {
      // 本地目录独立读取；官方网络超时不能挡住已安装插件。
      const params =
        input.scope === "local"
          ? { forceRefetch: input.force, marketplaceKinds: ["local"] }
          : { forceRefetch: input.force };
      const raw = NativeCatalogSchema.parse(
        await client.request("plugin/list", params, READ_TIMEOUT_MS),
      );
      const marketplaces = raw.marketplaces.filter(
        (marketplace) =>
          input.scope === "installed" ||
          (marketplace.path === null ? input.scope === "official" : input.scope === "local"),
      );
      return CodexPluginCatalogSchema.parse({
        marketplaces: await Promise.all(
          marketplaces.map(async (marketplace) => ({
            name: marketplace.name,
            title: marketplace.interface?.displayName ?? marketplace.name,
            path: marketplace.path,
            plugins: await Promise.all(marketplace.plugins.map(toPlugin)),
          })),
        ),
        errors: raw.marketplaceLoadErrors.map((error) => ({
          path: error.marketplacePath,
          message: error.message,
        })),
        total: marketplaces.reduce((sum, marketplace) => sum + marketplace.plugins.length, 0),
        nextOffset: null,
      });
    });
  }

  async function mutate(
    client: CodexAppServerClient,
    action: CodexPluginAction,
  ): Promise<CodexPluginActionResult> {
    const result: CodexPluginActionResult = { authApps: [], restartRequired: true };
    switch (action.kind) {
      case "install": {
        const target =
          action.marketplacePath === null
            ? { remoteMarketplaceName: action.marketplaceName }
            : { marketplacePath: action.marketplacePath };
        const installed = InstallResultSchema.parse(
          await client.request(
            "plugin/install",
            { ...target, pluginName: action.pluginName },
            WRITE_TIMEOUT_MS,
          ),
        );
        result.authApps = installed.appsNeedingAuth.map((app) => ({
          name: app.name,
          url: app.installUrl,
        }));
        break;
      }
      case "uninstall":
        await client.request("plugin/uninstall", { pluginId: action.pluginId }, WRITE_TIMEOUT_MS);
        break;
      case "set_enabled":
        await client.request(
          "config/value/write",
          {
            keyPath: `plugins.${JSON.stringify(action.pluginId)}.enabled`,
            value: action.enabled,
            mergeStrategy: "upsert",
          },
          WRITE_TIMEOUT_MS,
        );
        break;
      case "add_marketplace":
        await client.request(
          "marketplace/add",
          { source: action.source, refName: action.ref, sparsePaths: action.sparsePaths },
          WRITE_TIMEOUT_MS,
        );
        break;
      case "refresh_marketplace":
        await client.request(
          "marketplace/upgrade",
          { marketplaceName: action.name },
          WRITE_TIMEOUT_MS,
        );
        result.restartRequired = false;
        break;
      case "remove_marketplace":
        await client.request(
          "marketplace/remove",
          { marketplaceName: action.name },
          WRITE_TIMEOUT_MS,
        );
        break;
    }
    return result;
  }

  return {
    detail(target) {
      return withClient(async (client) => {
        const source =
          target.marketplacePath === null
            ? { remoteMarketplaceName: target.marketplaceName }
            : { marketplacePath: target.marketplacePath };
        const raw = DetailSchema.parse(
          await client.request(
            "plugin/read",
            { ...source, pluginName: target.pluginName },
            READ_TIMEOUT_MS,
          ),
        ).plugin;
        return {
          plugin: await toPlugin(raw.summary),
          description:
            raw.description ??
            raw.summary.interface?.longDescription ??
            raw.summary.interface?.shortDescription ??
            "",
          apps: raw.apps.map((app) => ({
            name: app.name,
            description: app.description ?? null,
            url: app.installUrl ?? null,
          })),
          skills: raw.skills,
          mcpServers: raw.mcpServers,
        };
      });
    },
    async catalog(input) {
      const readGeneration = generation;
      const key = `${input.scope}:${input.force}:${readGeneration}`;
      const cached = cache.get(input.scope);
      if (!input.force && cached && cached.expires > Date.now())
        return pageCatalog(cached.data, input);
      const existing = reads.get(key);
      if (existing) return pageCatalog(await existing, input);
      const pending = loadCatalog(input)
        .then((data) => {
          if (generation === readGeneration)
            cache.set(input.scope, { data, expires: Date.now() + 60_000 });
          return data;
        })
        .finally(() => reads.delete(key));
      reads.set(key, pending);
      return pageCatalog(await pending, input);
    },
    manage(action) {
      return mutations(async () => {
        generation += 1;
        cache.clear();
        try {
          return await withClient((client) => mutate(client, action));
        } finally {
          generation += 1;
          cache.clear();
        }
      });
    },
  };
}

function pageCatalog(
  catalog: CodexPluginCatalog,
  input: CodexPluginCatalogInput,
): CodexPluginCatalog {
  const query = (input.query ?? "").trim().toLocaleLowerCase();
  const matches = catalog.marketplaces.flatMap((marketplace) =>
    marketplace.plugins
      .filter(
        (plugin) =>
          (!input.installedOnly || plugin.installed) &&
          `${plugin.title} ${plugin.name} ${plugin.description} ${marketplace.name}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .map((plugin) => ({ marketplace: marketplace.name, plugin })),
  );
  matches.sort((a, b) => Number(b.plugin.installed) - Number(a.plugin.installed));
  const offset = input.offset ?? 0;
  const page = matches.slice(offset, offset + 50);
  return {
    marketplaces: catalog.marketplaces.map((marketplace) => ({
      ...marketplace,
      plugins: page
        .filter((entry) => entry.marketplace === marketplace.name)
        .map((entry) => entry.plugin),
    })),
    errors: catalog.errors,
    total: matches.length,
    nextOffset: offset + 50 < matches.length ? offset + 50 : null,
  };
}
