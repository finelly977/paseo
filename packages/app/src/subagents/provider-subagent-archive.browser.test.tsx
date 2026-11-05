import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { selectProviderSubagentsForParent } from "./select";
import { useProviderSubagentArchiveStore } from "./provider-subagent-archive-store";
import { providerSubagentKey, useProviderSubagentStore } from "./provider-store";

const SERVER_ID = "host";
const PARENT_ID = "parent";
const CHILD_ID = "child";
let root: Root | null = null;
let host: HTMLDivElement;

function VisibleProviderChildren() {
  const hiddenFromTrack = useProviderSubagentArchiveStore((state) => state.hiddenFromTrack);
  const hydrated = useProviderSubagentArchiveStore((state) => state.hydrated);
  const visibleIds = useProviderSubagentStore((state) =>
    selectProviderSubagentsForParent(
      state,
      { serverId: SERVER_ID, parentAgentId: PARENT_ID },
      hydrated,
      hiddenFromTrack,
    )
      .map((row) => row.id)
      .join(","),
  );
  return <div data-testid="visible-provider-children">{visibleIds}</div>;
}

beforeEach(() => {
  useProviderSubagentStore.setState({ descriptors: new Map(), timelines: new Map() });
  useProviderSubagentArchiveStore.setState({
    hiddenFromTrack: new Set(),
    hiddenRunIdByKey: {},
    hydrated: true,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<VisibleProviderChildren />);
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

test("已归档子任务重开时不闪现旧 running，新一轮才重新显示", async () => {
  const completed = {
    id: CHILD_ID,
    parentAgentId: PARENT_ID,
    provider: "codex" as const,
    title: "Process layout review",
    description: null,
    status: "completed" as const,
    createdAt: "2026-11-05T08:00:00.000Z",
    updatedAt: "2026-11-05T08:00:02.000Z",
    toolCallId: "call-1",
    runId: "child-turn-1",
  };
  const providerStore = useProviderSubagentStore.getState();
  providerStore.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });
  await vi.waitFor(() => expect(host.textContent).toBe(CHILD_ID));
  providerStore.hideFinishedForParent(SERVER_ID, PARENT_ID);
  await vi.waitFor(() => expect(host.textContent).toBe(""));
  providerStore.releaseParent(SERVER_ID, PARENT_ID);

  providerStore.replaceList(SERVER_ID, PARENT_ID, [
    {
      ...completed,
      status: "running",
      updatedAt: "2026-11-05T08:01:00.000Z",
      runId: null,
      toolCallId: "historical-call",
    },
  ]);
  await vi.waitFor(() => expect(host.textContent).toBe(""));

  providerStore.applyUpdate(SERVER_ID, {
    kind: "upsert",
    subagent: { ...completed, updatedAt: "2026-11-05T08:02:00.000Z" },
  });
  await vi.waitFor(() => expect(host.textContent).toBe(""));

  providerStore.applyUpdate(SERVER_ID, {
    kind: "upsert",
    subagent: {
      ...completed,
      status: "running",
      updatedAt: "2026-11-05T08:03:00.000Z",
      runId: "child-turn-2",
    },
  });
  await vi.waitFor(() => expect(host.textContent).toBe(CHILD_ID));
  expect(
    useProviderSubagentArchiveStore
      .getState()
      .hiddenFromTrack.has(providerSubagentKey(SERVER_ID, PARENT_ID, CHILD_ID)),
  ).toBe(false);
});

test("本地归档索引未恢复时不先显示子任务，恢复后仍尊重归档", async () => {
  useProviderSubagentArchiveStore.setState({ hydrated: false });
  useProviderSubagentStore.getState().applyUpdate(SERVER_ID, {
    kind: "upsert",
    subagent: {
      id: CHILD_ID,
      parentAgentId: PARENT_ID,
      provider: "codex",
      title: "Process layout review",
      description: null,
      status: "running",
      createdAt: "2026-11-05T08:00:00.000Z",
      updatedAt: "2026-11-05T08:01:00.000Z",
      toolCallId: "spawn",
      runId: null,
    },
  });
  await vi.waitFor(() => {
    expect(host.querySelector("[data-testid='visible-provider-children']")).not.toBeNull();
    expect(host.textContent).toBe("");
  });
  const key = providerSubagentKey(SERVER_ID, PARENT_ID, CHILD_ID);
  useProviderSubagentArchiveStore.setState({
    hydrated: true,
    hiddenFromTrack: new Set([key]),
    hiddenRunIdByKey: { [key]: "child-turn-1" },
  });
  await vi.waitFor(() => expect(host.textContent).toBe(""));
});
