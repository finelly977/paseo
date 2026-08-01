import { useCallback, useState, type CSSProperties, type DragEvent } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { SidebarProjectDropZoneProps } from "./sidebar-project-drop-zone";
import { extractDroppedDirectoryPaths } from "./sidebar-project-drop";

const dropZoneStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flex: "1 1 0%",
  flexDirection: "column",
  width: "100%",
  minHeight: 0,
};

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function SidebarProjectDropZone({
  children,
  onDropPaths,
  onError,
}: SidebarProjectDropZoneProps) {
  const { t } = useTranslation();
  const [isDragActive, setIsDragActive] = useState(false);
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  }, []);
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isFileDrag(event)) {
      setIsDragActive(true);
    }
  }, []);
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      setIsDragActive(false);
      try {
        const paths = extractDroppedDirectoryPaths(event.dataTransfer);
        void Promise.resolve(onDropPaths(paths)).catch(onError);
      } catch (error) {
        onError(error);
      }
    },
    [onDropPaths, onError],
  );

  return (
    <div
      aria-label={t("sidebar.project.drop.ariaLabel")}
      style={dropZoneStyle}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragActive ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={styles.overlayText}>{t("sidebar.project.drop.overlay")}</Text>
        </View>
      ) : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.accent,
    backgroundColor: `${theme.colors.surfaceSidebar}e6`,
    zIndex: 20,
  },
  overlayText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
