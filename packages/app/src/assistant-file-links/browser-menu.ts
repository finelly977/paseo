import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getIsElectron } from "@/constants/platform";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  isHtmlFile,
  openWorkspaceBrowserUrl,
  useOpenWorkspaceFileInBrowser,
} from "@/file-explorer/open-in-browser";
import { useAssistantFileLinkResolverContext } from "./provider";
import { classifyForResolution, type AssistantFileLinkSource } from "./resolver";
import type { UseFileLinkResult } from "./use-file-link";

export function useAssistantBrowserMenu(
  source: AssistantFileLinkSource,
  link: Pick<UseFileLinkResult, "target" | "canResolveFile" | "resolveFileTarget">,
) {
  const { t } = useTranslation();
  const { configRef } = useAssistantFileLinkResolverContext();
  const config = configRef.current;
  const browser = useOpenWorkspaceFileInBrowser({
    serverId: config.serverId,
    workspaceId: config.workspaceId,
    workspaceRoot: config.workspaceRoot,
  });
  const classification = classifyForResolution(source, { workspaceRoot: config.workspaceRoot });
  const externalUrl =
    classification.kind === "resolved" && classification.value.kind === "external"
      ? classification.value.url
      : null;
  const htmlFile =
    link.canResolveFile &&
    (isHtmlFile(link.target?.path ?? source.href) ||
      (source.text !== undefined && isHtmlFile(source.text)));
  const canOpenInternal =
    getIsElectron() && Boolean(externalUrl || (htmlFile && browser.available));
  const canOpenExternal = canOpenInternal || Boolean(externalUrl);
  useEffect(() => {
    if (browser.pending)
      configRef.current.toast?.show(t("workspace.fileActions.preparingPreview"), {
        durationMs: null,
      });
    else if (browser.error)
      configRef.current.toast?.show(browser.error, { variant: "error", durationMs: null });
  }, [browser.error, browser.pending, configRef, t]);
  const open = useStableEvent(async (destination: "internal" | "external") => {
    try {
      if (externalUrl) {
        if (destination === "external") await openExternalUrl(externalUrl);
        else
          openWorkspaceBrowserUrl({
            url: externalUrl,
            serverId: configRef.current.serverId,
            workspaceId: configRef.current.workspaceId,
          });
        return;
      }
      const file = await link.resolveFileTarget();
      if (!file) throw new Error("无法定位链接中的 HTML 文件");
      const opened = await browser.open(file.path, destination);
      if (opened) configRef.current.toast?.show(t("workspace.fileActions.previewOpened"));
    } catch (error) {
      console.error("打开对话链接失败", error);
      configRef.current.toast?.show(error instanceof Error ? error.message : String(error), {
        variant: "error",
        durationMs: null,
      });
    }
  });
  const onOpenInternal = useStableEvent(() => void open("internal"));
  const onOpenExternal = useStableEvent(() => void open("external"));
  return { canOpenInternal, canOpenExternal, onOpenInternal, onOpenExternal };
}
