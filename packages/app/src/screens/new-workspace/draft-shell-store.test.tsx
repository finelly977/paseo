/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { openNewWorkspaceDraftShellFile } from "../new-workspace-draft-shell-model";
import {
  getNewSessionDraftShellState,
  openNewSessionDraftFilesInWorkspace,
  releaseNewSessionDraft,
  updateNewSessionDraftShell,
  useNewSessionDraftStore,
  useRetainedNewSessionDraftId,
  type NewSessionDraftScope,
} from "./draft-shell-store";

const PROJECT_A: NewSessionDraftScope = { serverId: "server-1", sourceDirectory: "E:\\repo\\a" };
const PROJECT_B: NewSessionDraftScope = { serverId: "server-1", sourceDirectory: "E:/repo/b" };

function renderRetainedDraftId(scope: NewSessionDraftScope | null) {
  return renderHook(({ current }) => useRetainedNewSessionDraftId(current), {
    initialProps: { current: scope },
  });
}

beforeEach(() => {
  useNewSessionDraftStore.setState({
    draftIdByScope: {},
    releaseCountByScope: {},
    shellByDraftId: {},
  });
});

afterEach(() => {
  cleanup();
});

describe("retained new-session drafts", () => {
  it("returns the same draft when the same project opens the new page again", () => {
    const first = renderRetainedDraftId(PROJECT_A);
    const firstDraftId = first.result.current;
    first.unmount();

    const second = renderRetainedDraftId({ serverId: "server-1", sourceDirectory: "E:/repo/a/" });

    expect(firstDraftId).toMatch(/^draft_/);
    expect(second.result.current).toBe(firstDraftId);
  });

  it("keeps one independent draft per project", () => {
    const hook = renderRetainedDraftId(PROJECT_A);
    const draftA = hook.result.current;

    hook.rerender({ current: PROJECT_B });
    const draftB = hook.result.current;
    hook.rerender({ current: PROJECT_A });

    expect(draftB).not.toBe(draftA);
    expect(hook.result.current).toBe(draftA);
  });

  it("hands out a new draft after the previous one became a real session", () => {
    const hook = renderRetainedDraftId(PROJECT_A);
    const consumedDraftId = hook.result.current;
    if (!consumedDraftId) throw new Error("expected a retained draft id");

    act(() => releaseNewSessionDraft(consumedDraftId));

    expect(hook.result.current).toMatch(/^draft_/);
    expect(hook.result.current).not.toBe(consumedDraftId);
    expect(useNewSessionDraftStore.getState().draftIdByScope).toEqual({
      [JSON.stringify(["server-1", "E:/repo/a"])]: hook.result.current,
    });
  });

  it("does not retain anything without a project scope", () => {
    const hook = renderRetainedDraftId(null);

    expect(hook.result.current).toBeNull();
    expect(useNewSessionDraftStore.getState().draftIdByScope).toEqual({});
  });

  it("drops the retained file tabs when the draft is released", () => {
    updateNewSessionDraftShell("draft-1", (state) =>
      openNewWorkspaceDraftShellFile(state, { path: "src/a.ts" }),
    );

    releaseNewSessionDraft("draft-1");

    expect(getNewSessionDraftShellState("draft-1").tabs.map((tab) => tab.tabId)).toEqual([
      "draft-1",
    ]);
  });
});

describe("openNewSessionDraftFilesInWorkspace", () => {
  it("opens the draft's files in the created workspace in their original order", () => {
    updateNewSessionDraftShell("draft-1", (state) =>
      openNewWorkspaceDraftShellFile(openNewWorkspaceDraftShellFile(state, { path: "src/a.ts" }), {
        path: "src/b.ts",
        lineStart: 3,
      }),
    );

    openNewSessionDraftFilesInWorkspace({
      draftId: "draft-1",
      serverId: "server-1",
      workspaceId: "workspace-1",
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs("server-1:workspace-1");
    expect(tabs.map((tab) => tab.target)).toEqual([
      { kind: "file", path: "src/a.ts" },
      { kind: "file", path: "src/b.ts", lineStart: 3 },
    ]);
  });

  it("leaves the workspace untouched when the draft had no files open", () => {
    openNewSessionDraftFilesInWorkspace({
      draftId: "draft-empty",
      serverId: "server-1",
      workspaceId: "workspace-2",
    });

    expect(useWorkspaceLayoutStore.getState().getWorkspaceTabs("server-1:workspace-2")).toEqual([]);
  });
});
