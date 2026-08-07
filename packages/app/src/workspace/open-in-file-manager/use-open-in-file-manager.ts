import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

export function useOpenInFileManager(input: { workspacePath: string; isLocalExecution: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const workspacePath = input.workspacePath.trim();
  const { targets } = useDesktopOpenTargets({
    isLocalExecution: input.isLocalExecution && workspacePath.length > 0,
  });
  const fileManagerTarget = useMemo(
    () => targets.find((target) => target.kind === "file-manager") ?? null,
    [targets],
  );

  const openInFileManager = useCallback(
    async (filePath?: string | null) => {
      try {
        if (!fileManagerTarget || workspacePath.length === 0) {
          throw new Error("当前环境没有可用的文件管理器目标");
        }
        const normalizedFilePath = filePath?.trim() ?? "";
        await openDesktopTarget({
          editorId: fileManagerTarget.id,
          workspacePath,
          ...(normalizedFilePath ? { filePath: normalizedFilePath } : {}),
        });
      } catch (error) {
        console.error("[文件管理器] 打开路径失败", error);
        toast.error(t("workspace.fileActions.openInFileManagerFailed"));
      }
    },
    [fileManagerTarget, t, toast, workspacePath],
  );

  return {
    canOpenInFileManager: fileManagerTarget !== null && workspacePath.length > 0,
    openInFileManager,
  };
}
