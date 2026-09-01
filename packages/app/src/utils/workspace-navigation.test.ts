import { describe, expect, it } from "vitest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "/repo/worktree";
const AGENT_ID = "agent-1";

interface RecordedOpenedTab {
  key: string;
  target: WorkspaceTabTarget;
  pin: boolean;
}

function createFakeLayout() {
  const openedTabs: RecordedOpenedTab[] = [];
  return {
    openedTabs,
    openTabFocused: (key: string, target: WorkspaceTabTarget, options?: { pin?: boolean }) => {
      openedTabs.push({ key, target, pin: options?.pin === true });
      return target.kind === "agent" ? target.agentId : null;
    },
  };
}

describe("prepareWorkspaceTab", () => {
  it("opens and focuses an agent tab", () => {
    const layout = createFakeLayout();

    prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
      },
      layout,
    );

    expect(layout.openedTabs).toEqual([
      {
        key: "server-1:/repo/worktree",
        target: { kind: "agent", agentId: AGENT_ID },
        pin: false,
      },
    ]);
  });

  it("reveals and pins an archived agent with one layout update", () => {
    const layout = createFakeLayout();

    prepareWorkspaceTab(
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
        pin: true,
      },
      layout,
    );

    expect(layout.openedTabs).toEqual([
      {
        key: "server-1:/repo/worktree",
        target: { kind: "agent", agentId: AGENT_ID },
        pin: true,
      },
    ]);
  });
});
