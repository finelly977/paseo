// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarWorkspacePinStore } from "./sidebar-workspace-pin-store";

describe("sidebar-workspace-pin-store", () => {
  beforeEach(() => {
    useSidebarWorkspacePinStore.setState({ projectPinnedAtByWorkspaceKey: {} });
  });

  it("分别保存和取消工作区内置顶", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T08:00:00.000Z"));

    useSidebarWorkspacePinStore.getState().setProjectPinned("server:workspace", true);
    expect(useSidebarWorkspacePinStore.getState().projectPinnedAtByWorkspaceKey).toEqual({
      "server:workspace": "2026-09-22T08:00:00.000Z",
    });

    useSidebarWorkspacePinStore.getState().setProjectPinned("server:workspace", false);
    expect(useSidebarWorkspacePinStore.getState().projectPinnedAtByWorkspaceKey).toEqual({});
    vi.useRealTimers();
  });

  it("拒绝空工作区标识", () => {
    expect(() => useSidebarWorkspacePinStore.getState().setProjectPinned("  ", true)).toThrow(
      "工作区内置顶需要有效的工作区标识",
    );
  });
});
