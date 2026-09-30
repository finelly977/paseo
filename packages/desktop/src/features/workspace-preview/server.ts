import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { WorkspacePreviewResult } from "@getpaseo/protocol/workspace-preview";
import {
  normalizePreviewAssetPath,
  WorkspacePreviewPathError,
} from "@getpaseo/protocol/workspace-preview";

export interface WorkspacePreviewServer {
  open(path: string): string;
  close(): Promise<void>;
}

export async function createWorkspacePreviewServer(
  read: (path: string) => Promise<WorkspacePreviewResult>,
): Promise<WorkspacePreviewServer> {
  const token = randomBytes(32).toString("hex");
  const cookieName = `paseo_preview_${token.slice(0, 12)}`;
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error("工作区网页预览请求失败", error);
      const status = error instanceof WorkspacePreviewPathError ? 403 : 502;
      if (!response.headersSent)
        response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("文件读取失败，请确认主机仍已连接，然后刷新页面。");
    });
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("预览服务未获得本机端口");
  const origin = `http://127.0.0.1:${address.port}`;
  const expectedHost = `127.0.0.1:${address.port}`;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.headers.host !== expectedHost) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === `/__paseo_open/${token}`) {
      const path = normalizePreviewAssetPath(url.searchParams.get("path") ?? "");
      response.setHeader("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/`);
      response.writeHead(302, {
        Location: `/${path.split("/").map(encodeURIComponent).join("/")}`,
      });
      response.end();
      return;
    }
    const cookies = (request.headers.cookie ?? "").split(";").map((cookie) => cookie.trim());
    if (!cookies.includes(`${cookieName}=${token}`)) {
      response.writeHead(403);
      response.end("预览授权已失效，请从 Paseo 重新打开文件。");
      return;
    }
    const path = normalizePreviewAssetPath(decodeURIComponent(url.pathname));
    const result = await read(path);
    if (result.status === "error") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(result.error);
      return;
    }
    response.writeHead(200, {
      "Content-Type": result.mimeType,
      "Content-Length": result.bytes.byteLength,
    });
    response.end(request.method === "HEAD" ? undefined : result.bytes);
  }

  return {
    open(path) {
      const assetPath = normalizePreviewAssetPath(path);
      return `${origin}/__paseo_open/${token}?path=${encodeURIComponent(assetPath)}`;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    },
  };
}
