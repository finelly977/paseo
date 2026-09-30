import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopHost } from "@/desktop/host";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { createWorkspaceBrowser } from "@/stores/browser-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  WorkspacePreviewReadSchema,
  workspacePreviewMimeType,
  workspacePreviewRelativePath,
} from "@getpaseo/protocol/workspace-preview";

let bridgeReady: Promise<void> | null = null;

export function WorkspacePreviewBridge(): null {
  useEffect(() => {
    if (!getDesktopHost()?.workspacePreview) return;
    void ensurePreviewReadBridge().catch((error: unknown) =>
      console.error("初始化工作区预览桥接失败", error),
    );
  }, []);
  return null;
}

function ensurePreviewReadBridge(): Promise<void> {
  if (bridgeReady) return bridgeReady;
  const host = getDesktopHost();
  const preview = host?.workspacePreview;
  const events = host?.events?.on;
  if (!preview || !events) throw new Error("请更新桌面应用后使用 HTML 预览");
  bridgeReady = Promise.resolve(
    events("workspace-preview-read", (value) => {
      void (async () => {
        const input = WorkspacePreviewReadSchema.parse(value);
        try {
          const client = useSessionStore.getState().sessions[input.serverId]?.client;
          if (!client || !client.isConnected) throw new Error("主机未连接，请重新连接后刷新预览");
          const file = await client.readFile(input.cwd, input.path, undefined, 20 * 1024 * 1024);
          await preview.complete({
            requestId: input.requestId,
            result: {
              status: "file",
              bytes: new Uint8Array(file.bytes),
              mimeType: workspacePreviewMimeType(input.path),
            },
          });
        } catch (error) {
          console.error("读取网页预览资源失败", error);
          await preview.complete({
            requestId: input.requestId,
            result: {
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      })().catch((error: unknown) => console.error("网页预览桥接失败", error));
    }),
  ).then(() => undefined);
  return bridgeReady;
}

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function openWorkspaceBrowserUrl(input: {
  url: string;
  serverId: string | undefined;
  workspaceId: string | null | undefined;
}): void {
  if (!input.serverId || !input.workspaceId) throw new Error("请先创建工作区，再打开内置浏览器");
  const key = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!key) throw new Error("工作区标识无效");
  const { browserId } = createWorkspaceBrowser({ initialUrl: input.url });
  useWorkspaceLayoutStore.getState().openTabFocused(key, { kind: "browser", browserId });
}

export function useOpenWorkspaceFileInBrowser(input: {
  serverId: string | undefined;
  workspaceRoot: string | undefined;
  workspaceId?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = getDesktopHost()?.workspacePreview;
  const inProgress = useRef(false);
  const open = useCallback(
    async (path: string, target: "internal" | "external") => {
      if (inProgress.current) return;
      inProgress.current = true;
      setPending(true);
      setError(null);
      try {
        if (!preview) throw new Error("当前平台不支持工作区 HTML 预览，请使用桌面应用");
        if (!input.serverId || !input.workspaceRoot) throw new Error("文件缺少主机或工作区目录");
        const relativePath = workspacePreviewRelativePath({ cwd: input.workspaceRoot, path });
        const client = useSessionStore.getState().sessions[input.serverId]?.client;
        if (!client || !client.isConnected) throw new Error("主机未连接");
        await client.readFile(input.workspaceRoot, relativePath, undefined, 20 * 1024 * 1024);
        await ensurePreviewReadBridge();
        const url = await preview.open({
          serverId: input.serverId,
          cwd: input.workspaceRoot,
          path: relativePath,
        });
        if (target === "external") await openExternalUrl(url);
        else {
          openWorkspaceBrowserUrl({
            url,
            serverId: input.serverId,
            workspaceId: input.workspaceId,
          });
        }
        return true;
      } catch (openingError) {
        console.error("打开网页预览失败", openingError);
        setError(openingError instanceof Error ? openingError.message : String(openingError));
        return false;
      } finally {
        setPending(false);
        inProgress.current = false;
      }
    },
    [input.serverId, input.workspaceId, input.workspaceRoot, preview],
  );
  return { available: Boolean(preview), pending, error, open, dismissError: () => setError(null) };
}
