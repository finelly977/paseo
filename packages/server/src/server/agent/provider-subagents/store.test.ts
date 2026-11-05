import { describe, expect, test } from "vitest";
import { ProviderSubagentStore } from "./store.js";

describe("ProviderSubagentStore", () => {
  test("子任务原生回合身份不随重放时间和父工具调用改变", () => {
    const store = new ProviderSubagentStore();
    store.apply("parent", "codex", {
      type: "upsert",
      id: "child",
      status: "completed",
      runId: "child-turn-1",
      toolCallId: "spawn",
    });
    store.apply("parent", "codex", {
      type: "upsert",
      id: "child",
      status: "running",
      toolCallId: "historical-spawn",
    });
    expect(store.get("parent", "child")).toMatchObject({ runId: "child-turn-1" });
    store.apply("parent", "codex", {
      type: "upsert",
      id: "child",
      status: "running",
      runId: "child-turn-2",
    });
    expect(store.get("parent", "child")).toMatchObject({ runId: "child-turn-2" });
  });
  test("原生子任务核对后替换正文并更换代际，不重复追加旧片段", () => {
    const store = new ProviderSubagentStore();
    store.apply("parent", "codex", { type: "upsert", id: "child", status: "completed" });
    store.apply("parent", "codex", {
      type: "timeline",
      id: "child",
      item: { type: "assistant_message", text: "旧片段" },
    });
    const previous = store.fetchTimeline("parent", "child");
    store.replaceTimeline("parent", "child", [
      {
        item: { type: "assistant_message", messageId: "final", text: "原生完整结果" },
        timestamp: "2026-11-05T00:00:01.000Z",
      },
    ]);
    const next = store.fetchTimeline("parent", "child");
    expect(next.epoch).not.toBe(previous.epoch);
    expect(next.rows.map((row) => row.item)).toEqual([
      { type: "assistant_message", messageId: "final", text: "原生完整结果" },
    ]);
    store.replaceTimeline("parent", "child", [
      {
        item: { type: "assistant_message", messageId: "final", text: "原生完整结果" },
        timestamp: "2026-11-05T00:00:01.000Z",
      },
    ]);
    expect(store.fetchTimeline("parent", "child").rows).toHaveLength(1);
    expect(store.fetchTimeline("parent", "child").epoch).toBe(next.epoch);
  });
  test("keeps provider children and their timelines scoped to the parent agent", () => {
    const subagents = new ProviderSubagentStore();

    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      title: "Explore",
      cwd: "/workspace/child",
      status: "running",
      timestamp: "2026-07-12T10:00:00.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "timeline",
      id: "child-1",
      item: { type: "assistant_message", text: "Found it." },
      timestamp: "2026-07-12T10:00:01.000Z",
    });
    subagents.apply("parent-a", "codex", {
      type: "upsert",
      id: "child-1",
      status: "completed",
      timestamp: "2026-07-12T10:00:02.000Z",
    });
    subagents.apply("parent-b", "claude", {
      type: "upsert",
      id: "child-1",
      title: "Review",
      status: "running",
      timestamp: "2026-07-12T10:00:03.000Z",
    });

    expect(subagents.list("parent-a")).toEqual([
      expect.objectContaining({
        id: "child-1",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Explore",
        cwd: "/workspace/child",
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
      }),
    ]);
    expect(subagents.fetchTimeline("parent-a", "child-1").rows).toEqual([
      {
        seq: 1,
        timestamp: "2026-07-12T10:00:01.000Z",
        item: { type: "assistant_message", text: "Found it." },
      },
    ]);
    expect(subagents.list("parent-b")[0]).toMatchObject({ provider: "claude", title: "Review" });
    expect(subagents.deleteParent("parent-a")).toEqual([
      { type: "remove", parentAgentId: "parent-a", subagentId: "child-1" },
    ]);
    expect(subagents.list("parent-a")).toEqual([]);
    expect(subagents.list("parent-b")).toHaveLength(1);
  });

  test("limits oversized provider child tool output before storage", () => {
    const subagents = new ProviderSubagentStore();
    const output = "x".repeat(70 * 1024);
    const update = subagents.apply("parent-a", "opencode", {
      type: "timeline",
      id: "child-1",
      item: {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "print", output },
      },
    });

    expect(update.type).toBe("timeline");
    const [row] = subagents.fetchTimeline("parent-a", "child-1").rows;
    expect(row?.item).toMatchObject({
      type: "tool_call",
      detail: { type: "shell", output: "x".repeat(64 * 1024) },
    });
  });

  test("pages provider history on projected item boundaries", () => {
    const subagents = new ProviderSubagentStore();
    for (let index = 0; index < 101; index += 1) {
      subagents.apply("parent-a", "opencode", {
        type: "timeline",
        id: "child-1",
        item: { type: "assistant_message", text: String(index) },
      });
    }

    const page = subagents.fetchTimeline("parent-a", "child-1", {
      direction: "tail",
      limit: 1,
    });
    expect(page.rows).toHaveLength(101);
    expect(page.rows[0]?.seq).toBe(1);
    expect(page.rows.at(-1)?.seq).toBe(101);
    expect(page.hasOlder).toBe(false);
  });
});
