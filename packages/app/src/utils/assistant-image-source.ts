import { localFileSourceToPath } from "@/attachments/utils";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";

export type AssistantImageSourceResolution =
  | { kind: "direct"; uri: string }
  | { kind: "file_rpc"; cwd: string; path: string };

export function resolveAssistantImageErrorText(
  error: unknown,
  labels: { fallbackText: string; missingSourceText: string },
): string {
  if (!(error instanceof Error)) return labels.fallbackText;
  return /\bENOENT\b|file not found|文件不存在|文件未找到/i.test(error.message)
    ? labels.missingSourceText
    : error.message;
}

export function resolveAssistantImageSource(input: {
  source: string;
  workspaceRoot?: string;
}): AssistantImageSourceResolution | null {
  const source = input.source.trim();
  if (!source) {
    return null;
  }

  if (/^(https?:|data:|blob:)/i.test(source)) {
    return { kind: "direct", uri: source };
  }

  const readTarget = resolveFilePreviewReadTarget({
    path: localFileSourceToPath(source),
    workspaceRoot: input.workspaceRoot,
  });
  if (!readTarget) {
    return null;
  }

  return {
    kind: "file_rpc",
    cwd: readTarget.cwd,
    path: readTarget.path,
  };
}
