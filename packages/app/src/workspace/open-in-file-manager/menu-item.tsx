import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { getIsElectron } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useOpenInFileManager } from "@/workspace/open-in-file-manager/use-open-in-file-manager";

interface OpenInFileManagerMenuItemProps {
  path?: string | null;
  testID: string;
}

const ThemedFolderOpen = withUnistyles(FolderOpen);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const leadingIcon = <ThemedFolderOpen size={14} uniProps={foregroundMutedColorMapping} />;

export function OpenInFileManagerMenuItem({ path, testID }: OpenInFileManagerMenuItemProps) {
  const { t } = useTranslation();
  const isElectron = getIsElectron();
  const workspacePath = path?.trim() ?? "";
  const { canOpenInFileManager, openInFileManager } = useOpenInFileManager({
    workspacePath,
    isLocalExecution: isElectron && workspacePath.length > 0,
  });
  const handleOpenInFileManager = useCallback(() => {
    void openInFileManager();
  }, [openInFileManager]);

  if (!isElectron || !canOpenInFileManager) {
    return null;
  }

  return (
    <DropdownMenuItem testID={testID} leading={leadingIcon} onSelect={handleOpenInFileManager}>
      {t("workspace.fileActions.openInFileManager")}
    </DropdownMenuItem>
  );
}
