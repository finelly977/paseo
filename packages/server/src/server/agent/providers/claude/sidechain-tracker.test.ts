import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeSidechainTracker } from "./sidechain-tracker.js";

describe("ClaudeSidechainTracker", () => {
  it("uses Claude's native agent name for the provider subagent title", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => ({
        name: "repo_researcher",
        subagent_type: "Explore",
        description: "Inspect the repository",
      }),
    });

    const events = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: { content: [] },
      } as unknown as SDKMessage,
      "task-1",
    );

    expect(events[0]).toEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "upsert",
        id: "task-1",
        title: "repo_researcher",
        description: "Inspect the repository",
        status: "running",
        toolCallId: "task-1",
      },
    });
  });

  it("routes a resumed native task through its original sidechain identity", () => {
    const toolInputs = new Map([
      ["task-original", { subagent_type: "Explore", description: "Inspect the repository" }],
    ]);
    const tracker = new ClaudeSidechainTracker({
      getToolInput: (toolUseId) => toolInputs.get(toolUseId) ?? null,
    });
    expect(
      tracker.observeTaskStarted({
        type: "system",
        subtype: "task_started",
        task_id: "native-task",
        tool_use_id: "task-original",
        task_type: "local_agent",
        subagent_type: "Explore",
        prompt: "Initial prompt",
      } as unknown as SDKMessage),
    ).toEqual([]);
    toolInputs.clear();
    tracker.clear();

    const resumed = tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "native-task",
      tool_use_id: "task-resumed",
      task_type: "local_agent",
      subagent_type: "Explore",
      description: "Changed description",
      prompt: "Resumed prompt",
    } as unknown as SDKMessage);
    const output = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-resumed",
        message: { content: [{ type: "text", text: "Resumed output" }] },
      } as unknown as SDKMessage,
      "task-resumed",
    );

    expect([...resumed, ...output]).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "timeline",
        id: "task-original",
        item: { type: "user_message", text: "Resumed prompt" },
      },
    });
    expect([...resumed, ...output]).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "upsert",
        id: "task-original",
        title: "Explore",
        description: "Inspect the repository",
        status: "running",
        toolCallId: "task-original",
      },
    });
    expect(
      [...resumed, ...output].every(
        (event) => event.type !== "provider_subagent" || event.event.id !== "task-resumed",
      ),
    ).toBe(true);
    expect(tracker.finish("task-resumed", "completed")).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: expect.objectContaining({
        type: "upsert",
        id: "task-original",
        status: "completed",
      }),
    });
  });
});
