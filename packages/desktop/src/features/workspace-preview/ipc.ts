import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import {
  WorkspacePreviewOpenSchema,
  WorkspacePreviewCompleteSchema,
  type WorkspacePreviewScope,
  type WorkspacePreviewResult,
} from "@getpaseo/protocol/workspace-preview";
import { assertTrustedIpcSender } from "../../security/trusted-renderer.js";
import { createWorkspacePreviewServer, type WorkspacePreviewServer } from "./server.js";

interface PendingRead {
  owner: WebContents;
  resolve: (result: WorkspacePreviewResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function registerWorkspacePreviewHandlers(): void {
  const servers = new Map<number, Map<string, Promise<WorkspacePreviewServer>>>();
  const pending = new Map<string, PendingRead>();
  function read(
    owner: WebContents,
    scope: WorkspacePreviewScope,
    path: string,
  ): Promise<WorkspacePreviewResult> {
    if (owner.isDestroyed()) throw new Error("预览所属窗口已关闭");
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("工作区预览读取超时"));
      }, 30_000);
      pending.set(requestId, { owner, resolve, reject, timer });
      owner.send("paseo:event:workspace-preview-read", { ...scope, path, requestId });
    });
  }
  ipcMain.handle("paseo:workspace-preview:open", async (event, value: unknown) => {
    assertTrustedIpcSender(event);
    const input = WorkspacePreviewOpenSchema.parse(value);
    const owner = event.sender;
    let ownerServers = servers.get(owner.id);
    if (!ownerServers) {
      ownerServers = new Map();
      const ownedServers = ownerServers;
      servers.set(owner.id, ownerServers);
      owner.once("destroyed", () => {
        servers.delete(owner.id);
        for (const server of ownedServers.values())
          void server
            .then((previewServer) => previewServer.close())
            .catch((error: unknown) => console.error("释放工作区预览失败", error));
        for (const [id, request] of pending) {
          if (request.owner !== owner) continue;
          clearTimeout(request.timer);
          pending.delete(id);
          request.reject(new Error("预览所属窗口已关闭"));
        }
      });
    }
    const scope: WorkspacePreviewScope = {
      serverId: input.serverId,
      cwd: input.cwd.replaceAll("\\", "/"),
    };
    const key = JSON.stringify([scope.serverId, scope.cwd]);
    let server = ownerServers.get(key);
    if (!server) {
      server = createWorkspacePreviewServer((path) => read(owner, scope, path));
      ownerServers.set(key, server);
      try {
        await server;
      } catch (error) {
        ownerServers.delete(key);
        throw error;
      }
    }
    return (await server).open(input.path);
  });
  ipcMain.handle("paseo:workspace-preview:complete", (event, value: unknown) => {
    assertTrustedIpcSender(event);
    const input = WorkspacePreviewCompleteSchema.parse(value);
    const request = pending.get(input.requestId);
    if (!request) return;
    if (request.owner !== event.sender) throw new Error("预览响应不属于此窗口");
    clearTimeout(request.timer);
    pending.delete(input.requestId);
    request.resolve(input.result);
  });
}
