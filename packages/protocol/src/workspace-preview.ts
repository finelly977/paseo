import { z } from "zod";

export const WorkspacePreviewScopeSchema = z.object({
  serverId: z.string().min(1),
  cwd: z.string().min(1),
});
export const WorkspacePreviewOpenSchema = WorkspacePreviewScopeSchema.extend({
  path: z.string().min(1),
});
export const WorkspacePreviewReadSchema = WorkspacePreviewOpenSchema.extend({
  requestId: z.string(),
});
export const WorkspacePreviewResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("file"), bytes: z.instanceof(Uint8Array), mimeType: z.string() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);
export const WorkspacePreviewCompleteSchema = z.object({
  requestId: z.string(),
  result: WorkspacePreviewResultSchema,
});

export type WorkspacePreviewScope = z.infer<typeof WorkspacePreviewScopeSchema>;
export type WorkspacePreviewOpen = z.infer<typeof WorkspacePreviewOpenSchema>;
export type WorkspacePreviewRead = z.infer<typeof WorkspacePreviewReadSchema>;
export type WorkspacePreviewResult = z.infer<typeof WorkspacePreviewResultSchema>;
export type WorkspacePreviewComplete = z.infer<typeof WorkspacePreviewCompleteSchema>;

const PREVIEW_MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export function workspacePreviewMimeType(path: string): string {
  const extension = path.split(".").pop();
  return extension
    ? (PREVIEW_MIME_TYPES[extension.toLowerCase()] ?? "application/octet-stream")
    : "application/octet-stream";
}

export class WorkspacePreviewPathError extends Error {}

export function normalizePreviewAssetPath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = path.split("/");
  if (
    !path ||
    segments.some(
      (segment) => segment === ".." || segment.startsWith(".") || segment.includes(":"),
    ) ||
    path.includes("\0")
  ) {
    throw new WorkspacePreviewPathError("预览只允许读取工作区内的非隐藏资源");
  }
  return path;
}

export function workspacePreviewRelativePath(input: { cwd: string; path: string }): string {
  const root = input.cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  let path = input.path.replaceAll("\\", "/");
  const absolute = path.startsWith("/") || /^[a-z]:\//i.test(path);
  if (absolute) {
    const windowsRoot = /^[a-z]:\//i.test(root);
    const comparableRoot = windowsRoot ? root.toLowerCase() : root;
    const comparablePath = windowsRoot ? path.toLowerCase() : path;
    if (!comparablePath.startsWith(`${comparableRoot}/`))
      throw new Error("HTML 预览只能打开当前工作区中的文件");
    path = path.slice(root.length + 1);
  }
  return normalizePreviewAssetPath(path);
}
