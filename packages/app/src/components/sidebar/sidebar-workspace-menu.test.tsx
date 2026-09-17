/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarWorkspaceMenu } from "./sidebar-workspace-menu";

void testI18n;

const noop = () => undefined;

const { setStringAsyncMock, copiedToastMock } = vi.hoisted(() => ({
  setStringAsyncMock: vi.fn(async () => true),
  copiedToastMock: vi.fn(),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: setStringAsyncMock,
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ copied: copiedToastMock, error: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({
    children,
  }: {
    children: React.ReactNode | ((state: { hovered: boolean }) => React.ReactNode);
  }) => <div>{typeof children === "function" ? children({ hovered: false }) : children}</div>,
}));

vi.mock("@/components/ui/shortcut", () => ({
  Shortcut: () => null,
}));

vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({
  OpenInFileManagerMenuItem: () => null,
}));

describe("SidebarWorkspaceMenu", () => {
  beforeEach(() => {
    setStringAsyncMock.mockClear();
    copiedToastMock.mockClear();
  });

  it("copies the represented session ID", async () => {
    render(
      <SidebarWorkspaceMenu
        workspaceKey="server-1:workspace-1"
        sessionId="codex-thread-42"
        onArchive={noop}
      />,
    );

    fireEvent.click(
      screen.getByTestId("sidebar-workspace-menu-copy-session-id-server-1:workspace-1"),
    );

    await waitFor(() => {
      expect(setStringAsyncMock).toHaveBeenCalledWith("codex-thread-42");
      expect(copiedToastMock).toHaveBeenCalledOnce();
    });
  });
});
