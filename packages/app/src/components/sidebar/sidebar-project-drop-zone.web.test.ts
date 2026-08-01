import { describe, expect, it, vi } from "vitest";
import type { DesktopHostBridge } from "@/desktop/host";
import { extractDroppedDirectoryPaths } from "./sidebar-project-drop";

function dataTransfer(input: { file: File; isFile?: boolean }): DataTransfer {
  return {
    items: [
      {
        kind: "file",
        getAsFile: () => input.file,
        webkitGetAsEntry: () => ({ isFile: input.isFile ?? false }),
      },
    ],
    files: [],
    types: ["Files"],
  } as unknown as DataTransfer;
}

describe("侧栏文件夹拖入", () => {
  it("通过 Electron 桥接读取文件夹绝对路径", () => {
    const file = { name: "paseo" } as File;
    const getPathForFile = vi.fn(() => "E:\\paseo");
    const host: DesktopHostBridge = { webUtils: { getPathForFile } };

    expect(extractDroppedDirectoryPaths(dataTransfer({ file }), host)).toEqual(["E:\\paseo"]);
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it("拒绝拖入单个文件", () => {
    const file = { name: "notes.txt" } as File;
    const host: DesktopHostBridge = { webUtils: { getPathForFile: () => "E:\\notes.txt" } };

    expect(() => extractDroppedDirectoryPaths(dataTransfer({ file, isFile: true }), host)).toThrow(
      "这里只能拖入文件夹",
    );
  });
});
