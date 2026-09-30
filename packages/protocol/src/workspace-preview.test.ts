import { test, expect } from "vitest";
import {
  normalizePreviewAssetPath,
  workspacePreviewRelativePath,
  workspacePreviewMimeType,
} from "./workspace-preview.js";

test("Windows 与 Ubuntu 的工作区路径转换为相同的相对预览地址", () => {
  expect(workspacePreviewRelativePath({ cwd: "E:\\项目", path: "e:\\项目\\页面\\预览.html" })).toBe(
    "页面/预览.html",
  );
  expect(
    workspacePreviewRelativePath({
      cwd: "/home/user/project",
      path: "/home/user/project/pages/index.html",
    }),
  ).toBe("pages/index.html");
  expect(
    workspacePreviewRelativePath({ cwd: "/home/user/project", path: "pages/index.html" }),
  ).toBe("pages/index.html");
  expect(() =>
    workspacePreviewRelativePath({ cwd: "/home/user/project", path: "/etc/passwd" }),
  ).toThrow("当前工作区");
  expect(() => normalizePreviewAssetPath("../secret")).toThrow("非隐藏资源");
  expect(() => normalizePreviewAssetPath(".git/config")).toThrow("非隐藏资源");
  expect(() => normalizePreviewAssetPath("C:/secret")).toThrow("非隐藏资源");
  expect(workspacePreviewMimeType("STYLE.CSS")).toBe("text/css; charset=utf-8");
  expect(workspacePreviewMimeType("main.mjs")).toBe("text/javascript; charset=utf-8");
});
