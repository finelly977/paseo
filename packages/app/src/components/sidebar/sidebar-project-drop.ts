import { getDesktopHost, type DesktopHostBridge } from "@/desktop/host";

export function extractDroppedDirectoryPaths(
  dataTransfer: DataTransfer,
  host: DesktopHostBridge | null = getDesktopHost(),
): string[] {
  const getPathForFile = host?.webUtils?.getPathForFile;
  if (typeof getPathForFile !== "function") {
    throw new Error("当前桌面运行环境无法读取拖入文件夹的本地路径。");
  }

  const paths: string[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = item.webkitGetAsEntry();
    if (entry?.isFile) {
      throw new Error("这里只能拖入文件夹，不能拖入单个文件。");
    }
    const file = item.getAsFile();
    if (!file) {
      throw new Error("无法读取拖入文件夹，请重新拖入。");
    }
    const path = getPathForFile(file);
    if (!path.trim()) {
      throw new Error("无法读取拖入文件夹的本地路径，请确认使用的是系统文件管理器。");
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  if (paths.length === 0) {
    for (const file of Array.from(dataTransfer.files)) {
      const path = getPathForFile(file);
      if (!path.trim()) {
        throw new Error("无法读取拖入文件夹的本地路径，请确认使用的是系统文件管理器。");
      }
      if (!paths.includes(path)) {
        paths.push(path);
      }
    }
  }

  if (paths.length === 0) {
    throw new Error("没有检测到可添加的文件夹。");
  }
  return paths;
}
