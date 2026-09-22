import { describe, expect, it } from "vitest";
import { shouldAutomaticallyCreateWorkspaceShell } from "./new-workspace-auto-shell";

const readyInput = {
  routeHasProject: true,
  hasDraftHandoff: false,
  selectedSourceDirectory: "C:/repo",
  clientReady: true,
  checkoutReady: true,
  isPending: false,
};

describe("shouldAutomaticallyCreateWorkspaceShell", () => {
  it("项目入口准备完成后直接创建空工作区外壳", () => {
    expect(shouldAutomaticallyCreateWorkspaceShell(readyInput)).toBe(true);
  });

  it("全局新建页仍保留项目选择流程", () => {
    expect(shouldAutomaticallyCreateWorkspaceShell({ ...readyInput, routeHasProject: false })).toBe(
      false,
    );
  });

  it("草稿交接和加载中的创建不会重复执行", () => {
    expect(shouldAutomaticallyCreateWorkspaceShell({ ...readyInput, hasDraftHandoff: true })).toBe(
      false,
    );
    expect(shouldAutomaticallyCreateWorkspaceShell({ ...readyInput, isPending: true })).toBe(false);
  });
});
