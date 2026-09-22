/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarWorkspaceMenu } from "./sidebar-workspace-menu";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
});

void testI18n;

const noop = () => undefined;

const { setStringAsyncMock, copiedToastMock } = vi.hoisted(() => ({
  setStringAsyncMock: vi.fn(async () => true),
  copiedToastMock: vi.fn(),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: setStringAsyncMock,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) =>
      typeof styles === "function"
        ? styles({ colors: { foreground: "#fff", foregroundMuted: "#aaa", surface2: "#222" } })
        : styles,
  },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", async () => {
  const { createElement } = await import("react");
  function Icon({ uniProps: _uniProps, ...props }: { uniProps?: unknown }) {
    return createElement("span", props);
  }
  return {
    Archive: Icon,
    CircleCheck: Icon,
    Copy: Icon,
    EyeOff: Icon,
    MoreVertical: Icon,
    Pencil: Icon,
    Pin: Icon,
    PinOff: Icon,
    RotateCw: Icon,
    ServerCog: Icon,
    Unplug: Icon,
  };
});

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ copied: copiedToastMock, error: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
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
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID?: string;
  }) => <div data-testid={testID}>{children}</div>,
  DropdownMenuSubTrigger: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID}>
      {children}
    </button>
  ),
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

  it("nests providers and their models under one root menu item", () => {
    const apply = vi.fn();
    render(
      <SidebarWorkspaceMenu
        workspaceKey="server-1:workspace-1"
        onArchive={noop}
        codexProviderInjections={[
          { id: "provider-a", name: "Provider A", models: ["model-a1", "model-a2"] },
          { id: "provider-b", name: "Provider B", models: ["model-b1"] },
        ]}
        onApplyCodexProviderInjection={apply}
      />,
    );

    expect(
      screen.getByTestId("sidebar-workspace-menu-codex-provider-injections-server-1:workspace-1"),
    ).toBeTruthy();
    const providers = screen.getByTestId("codex-provider-injection-providers");
    expect(
      providers.contains(screen.getByTestId("codex-provider-injection-provider-provider-a")),
    ).toBe(true);
    expect(
      screen
        .getByTestId("codex-provider-injection-models-provider-a")
        .contains(screen.getByTestId("codex-provider-injection-model-provider-a-model-a2")),
    ).toBe(true);

    fireEvent.click(screen.getByTestId("codex-provider-injection-model-provider-a-model-a2"));
    expect(apply).toHaveBeenCalledWith("provider-a", "model-a2");
  });

  it("keeps global and workspace-local pin actions together", () => {
    const toggleGlobal = vi.fn();
    const toggleProject = vi.fn();
    render(
      <SidebarWorkspaceMenu
        workspaceKey="server-1:workspace-1"
        onArchive={noop}
        isPinned={false}
        onTogglePin={toggleGlobal}
        isProjectPinned={true}
        onToggleProjectPin={toggleProject}
      />,
    );

    const pinMenu = screen.getByTestId("sidebar-workspace-menu-pin-server-1:workspace-1");
    const globalAction = screen.getByTestId(
      "sidebar-workspace-menu-pin-global-server-1:workspace-1",
    );
    const projectAction = screen.getByTestId(
      "sidebar-workspace-menu-pin-project-server-1:workspace-1",
    );
    expect(pinMenu.contains(globalAction)).toBe(true);
    expect(pinMenu.contains(projectAction)).toBe(true);

    fireEvent.click(globalAction);
    fireEvent.click(projectAction);
    expect(toggleGlobal).toHaveBeenCalledOnce();
    expect(toggleProject).toHaveBeenCalledOnce();
  });
});
