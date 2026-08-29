import { describe, expect, it } from "vitest";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  buildWorkspaceCommandCenterContributions,
  type WorkspaceCommandCenterSource,
} from "./workspace-contributions";

function source(): {
  value: WorkspaceCommandCenterSource;
  dispatched: KeyboardActionDefinition[];
} {
  const dispatched: KeyboardActionDefinition[] = [];
  return {
    value: {
      labels: {
        section: "Workspace actions",
        newAgent: "New agent",
        newTerminal: "New terminal",
        newBrowser: "New browser",
        splitRight: "Split pane right",
        splitDown: "Split pane down",
      },
      icons: {},
      shortcuts: {},
      capabilities: { canSplitPanes: true, canOpenBrowserTabs: true },
      dispatch: (action) => dispatched.push(action),
    },
    dispatched,
  };
}

describe("workspace command center contributions", () => {
  it("默认显示新智能体，并让终端、浏览器和分栏操作通过搜索出现", () => {
    const fixture = source();

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map(({ id, rank, visibility }) => ({ id, rank, visibility }))).toEqual([
      { id: "tab:new-agent", rank: 0, visibility: "always" },
      { id: "tab:new-terminal", rank: 1, visibility: "query" },
      { id: "tab:new-browser", rank: 2, visibility: "query" },
      { id: "pane:split-right", rank: 3, visibility: "query" },
      { id: "pane:split-down", rank: 4, visibility: "query" },
    ]);
  });

  it("omits browser and split actions when their existing capabilities are unavailable", () => {
    const fixture = source();
    fixture.value.capabilities = { canSplitPanes: false, canOpenBrowserTabs: false };

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map((item) => item.id)).toEqual(["tab:new-agent", "tab:new-terminal"]);
  });

  it("dispatches every tab and pane command to the workspace scope", () => {
    const fixture = source();
    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    for (const contribution of contributions) contribution.run();

    expect(fixture.dispatched).toEqual([
      { id: "workspace.tab.new", scope: "workspace" },
      { id: "workspace.terminal.new", scope: "workspace" },
      { id: "workspace.browser.new", scope: "workspace" },
      { id: "workspace.pane.split.right", scope: "workspace" },
      { id: "workspace.pane.split.down", scope: "workspace" },
    ]);
  });

  it("工作区操作不依赖右侧 Git 面板实现", () => {
    const fixture = source();

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map((item) => item.id)).toEqual([
      "tab:new-agent",
      "tab:new-terminal",
      "tab:new-browser",
      "pane:split-right",
      "pane:split-down",
    ]);
  });
});
