import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
// eslint-disable-next-line no-restricted-imports -- plugin client runtime injects host ReactNative.
import * as ReactNative from "react-native";
// eslint-disable-next-line no-restricted-imports -- plugin bundles receive TanStack's real runtime, not Paseo's query wrappers.
import * as ReactQuery from "@tanstack/react-query";
import * as Zod from "zod";
import {
  defineAttachmentSource,
  defineRpc,
  type PluginAttachmentSourceContribution,
  type PluginCommandCenterItemContribution,
  type PluginClientContribution,
  type PluginSidebarContribution,
  type PluginSurfaceProps,
  type PluginThemeContribution,
  type PluginTimelineRendererContribution,
  type PluginTimelineTransformerContribution,
  type PluginWorkspacePanelContribution,
  usePaseo,
  useAgent,
  useWorkspace,
  useRpc,
} from "@getpaseo/plugin";
import { createPluginContext, type PluginRegistrationCollector } from "@getpaseo/plugin/host";
import type { EvaluatedPlugin } from "./types";
import type { ComponentType } from "react";
import { Icon, resolvePluginIcon } from "./icons";
import { pluginReactNativeRuntime } from "./react-native/runtime";
import { parsePluginThemeContribution } from "./themes";

const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;
const TIMELINE_ITEM_TYPES = new Set([
  "user_message",
  "assistant_message",
  "reasoning",
  "tool_call",
  "todo",
  "error",
  "compaction",
]);

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (!CONTRIBUTION_ID.test(id)) throw new Error(`Invalid ${label}: ${value}`);
  return id;
}

export function evaluatePluginClientBundle(id: string, bundle: string): EvaluatedPlugin {
  const collector: PluginRegistrationCollector = {
    surfaces: [],
    sidebarItems: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSide: null,
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
  };
  const surfaceIds = new Set<string>();
  const sidebarItemIds = new Set<string>();
  const workspacePanelIds = new Set<string>();
  const commandCenterItemIds = new Set<string>();
  const attachmentSourceIds = new Set<string>();
  const themeIds = new Set<string>();
  const timelineTransformerIds = new Set<string>();
  const timelineRendererIds = new Set<string>();
  const pluginContext = createPluginContext({
    addSurface(surfaceId: string, Component: ComponentType<PluginSurfaceProps>) {
      const normalizedId = requireId(surfaceId, "surface id");
      if (surfaceIds.has(normalizedId)) throw new Error(`Duplicate surface: ${normalizedId}`);
      if (typeof Component !== "function")
        throw new Error(`Surface ${normalizedId} is not a component`);
      surfaceIds.add(normalizedId);
      collector.surfaces.push({ id: normalizedId, Component });
    },
    addSidebarItem(contribution: PluginSidebarContribution) {
      const normalizedId = requireId(contribution.id, "sidebar item id");
      if (sidebarItemIds.has(normalizedId))
        throw new Error(`Duplicate sidebar item: ${normalizedId}`);
      if (!contribution.title.trim()) throw new Error(`Sidebar item ${normalizedId} has no title`);
      if (!contribution.icon.trim()) throw new Error(`Sidebar item ${normalizedId} has no icon`);
      resolvePluginIcon(contribution.icon.trim());
      sidebarItemIds.add(normalizedId);
      collector.sidebarItems.push({
        id: normalizedId,
        title: contribution.title.trim(),
        icon: contribution.icon.trim(),
        surface: requireId(contribution.surface, "sidebar surface id"),
      });
    },
    addWorkspacePanel(contribution: PluginWorkspacePanelContribution) {
      const normalizedId = requireId(contribution.id, "workspace panel id");
      if (workspacePanelIds.has(normalizedId)) {
        throw new Error(`Duplicate workspace panel: ${normalizedId}`);
      }
      const title = contribution.title.trim();
      const icon = contribution.icon.trim();
      if (!title) throw new Error(`Workspace panel ${normalizedId} has no title`);
      if (!icon) throw new Error(`Workspace panel ${normalizedId} has no icon`);
      if (contribution.context !== "workspace" && contribution.context !== "agent") {
        throw new Error(`Workspace panel ${normalizedId} has invalid context`);
      }
      if (typeof contribution.Component !== "function") {
        throw new Error(`Workspace panel ${normalizedId} is not a component`);
      }
      resolvePluginIcon(icon);
      workspacePanelIds.add(normalizedId);
      collector.workspacePanels.push({ ...contribution, id: normalizedId, title, icon });
    },
    addCommandCenterItem(contribution: PluginCommandCenterItemContribution) {
      const normalizedId = requireId(contribution.id, "Command Center item id");
      if (commandCenterItemIds.has(normalizedId)) {
        throw new Error(`Duplicate Command Center item: ${normalizedId}`);
      }
      const title = contribution.title.trim();
      const icon = contribution.icon.trim();
      if (!title) throw new Error(`Command Center item ${normalizedId} has no title`);
      if (!icon) throw new Error(`Command Center item ${normalizedId} has no icon`);
      if (
        contribution.context !== "global" &&
        contribution.context !== "workspace" &&
        contribution.context !== "agent"
      ) {
        throw new Error(`Command Center item ${normalizedId} has invalid context`);
      }
      if (typeof contribution.onSelect !== "function") {
        throw new Error(`Command Center item ${normalizedId} has no callback`);
      }
      resolvePluginIcon(icon);
      commandCenterItemIds.add(normalizedId);
      collector.commandCenterItems.push({
        ...contribution,
        id: normalizedId,
        title,
        icon,
        keywords: contribution.keywords?.map((keyword) => keyword.trim()).filter(Boolean),
      });
    },
    addClientSide(contribution: PluginClientContribution) {
      if (collector.clientSide) throw new Error("Plugin has more than one client-side entrypoint");
      if (typeof contribution !== "function") {
        throw new Error("Plugin client-side entrypoint is not a function");
      }
      collector.clientSide = contribution;
    },
    addAttachmentSource(contribution: PluginAttachmentSourceContribution) {
      const normalizedId = requireId(contribution.id, "attachment source id");
      if (attachmentSourceIds.has(normalizedId)) {
        throw new Error(`Duplicate attachment source: ${normalizedId}`);
      }
      const title = contribution.title.trim();
      const icon = contribution.icon.trim();
      const pickerTitle = contribution.pickerTitle.trim();
      const searchPlaceholder = contribution.searchPlaceholder.trim();
      const method = contribution.search.name.trim();
      if (!title) throw new Error(`Attachment source ${normalizedId} has no title`);
      if (!icon) throw new Error(`Attachment source ${normalizedId} has no icon`);
      if (!pickerTitle) throw new Error(`Attachment source ${normalizedId} has no picker title`);
      if (!searchPlaceholder) {
        throw new Error(`Attachment source ${normalizedId} has no search placeholder`);
      }
      if (!method) throw new Error(`Attachment source ${normalizedId} has no search RPC`);
      resolvePluginIcon(icon);
      attachmentSourceIds.add(normalizedId);
      collector.attachmentSources.push({
        id: normalizedId,
        title,
        icon,
        pickerTitle,
        searchPlaceholder,
        search: { ...contribution.search, name: method },
      });
    },
    addTheme(contribution: PluginThemeContribution) {
      const normalizedId = requireId(contribution.id, "theme id");
      if (themeIds.has(normalizedId)) throw new Error(`Duplicate theme: ${normalizedId}`);
      const theme = parsePluginThemeContribution({ ...contribution, id: normalizedId });
      themeIds.add(normalizedId);
      collector.themes.push(theme);
    },
    addTimelineTransformer(contribution: PluginTimelineTransformerContribution) {
      const normalizedId = requireId(contribution.id, "时间线转换器标识");
      if (timelineTransformerIds.has(normalizedId)) {
        throw new Error(`时间线转换器重复：${normalizedId}`);
      }
      if (!contribution.query || typeof contribution.query.itemType !== "string") {
        throw new Error(`时间线转换器 ${normalizedId} 没有指定条目类型`);
      }
      if (!TIMELINE_ITEM_TYPES.has(contribution.query.itemType)) {
        throw new Error(
          `时间线转换器 ${normalizedId} 的条目类型无效：${contribution.query.itemType}`,
        );
      }
      if (typeof contribution.transform !== "function") {
        throw new Error(`时间线转换器 ${normalizedId} 没有转换函数`);
      }
      if (contribution.id !== normalizedId) {
        throw new Error(`时间线转换器标识无效：${contribution.id}`);
      }
      timelineTransformerIds.add(normalizedId);
      collector.timelineTransformers.push(contribution);
    },
    addTimelineRenderer(contribution: PluginTimelineRendererContribution) {
      const kind = requireId(contribution.kind, "时间线渲染器类型");
      if (!Number.isInteger(contribution.version) || contribution.version < 1) {
        throw new Error(`时间线渲染器 ${kind} 的版本无效`);
      }
      const rendererId = `${kind}/${contribution.version}`;
      if (timelineRendererIds.has(rendererId)) {
        throw new Error(`时间线渲染器重复：${rendererId}`);
      }
      if (!contribution.schema || typeof contribution.schema.safeParse !== "function") {
        throw new Error(`时间线渲染器 ${rendererId} 没有数据结构定义`);
      }
      if (typeof contribution.Component !== "function") {
        throw new Error(`时间线渲染器 ${rendererId} 没有渲染组件`);
      }
      timelineRendererIds.add(rendererId);
      collector.timelineRenderers.push({ ...contribution, kind });
    },
  });
  const runtimeRequire = (name: string): unknown => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return ReactJsxRuntime;
    if (name === "react-native") return ReactNative;
    if (name === "@getpaseo/plugin") {
      return {
        defineAttachmentSource,
        defineRpc,
        Icon,
        usePaseo,
        useAgent,
        useWorkspace,
        useRpc,
      };
    }
    if (name === "@getpaseo/plugin/react-native" || name === "@paseo/plugin/react-native") {
      return pluginReactNativeRuntime;
    }
    if (name === "@getpaseo/plugin/server") {
      return { defineAttachmentSource, defineRpc };
    }
    if (name === "@tanstack/react-query") return ReactQuery;
    if (name === "zod") return Zod;
    throw new Error(`Module "${name}" is not available in plugin client code`);
  };
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function")
    throw new Error(`Plugin ${id} client bundle is not executable`);
  const exports = factory(runtimeRequire);
  const setup =
    exports !== null && typeof exports === "object" ? Reflect.get(exports, "default") : undefined;
  if (typeof setup !== "function") {
    throw new Error(`Plugin ${id} must default export a function`);
  }
  const cleanup = setup(pluginContext);
  if (typeof cleanup !== "function") {
    throw new Error(`Plugin ${id} contribution must return a cleanup function`);
  }

  try {
    for (const item of collector.sidebarItems) {
      if (!surfaceIds.has(item.surface)) {
        throw new Error(`Sidebar item ${item.id} references missing surface ${item.surface}`);
      }
    }
  } catch (error) {
    try {
      void Promise.resolve(cleanup()).catch((cleanupError) => {
        console.warn(`[Plugins] Cleanup failed after setup error for ${id}`, cleanupError);
      });
    } catch (cleanupError) {
      console.warn(`[Plugins] Cleanup failed after setup error for ${id}`, cleanupError);
    }
    throw error;
  }
  return {
    id,
    cleanup,
    surfaces: collector.surfaces,
    sidebarItems: collector.sidebarItems,
    workspacePanels: collector.workspacePanels,
    commandCenterItems: collector.commandCenterItems,
    clientSide: collector.clientSide,
    attachmentSources: collector.attachmentSources,
    themes: collector.themes,
    timelineTransformers: collector.timelineTransformers,
    timelineRenderers: collector.timelineRenderers,
  };
}
