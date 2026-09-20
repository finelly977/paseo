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
    const started = tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "native-task",
      tool_use_id: "task-original",
      task_type: "local_agent",
      subagent_type: "Explore",
      prompt: "Initial prompt",
    } as unknown as SDKMessage);
    expect(started).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "timeline",
        id: "task-original",
        item: { type: "user_message", text: "Initial prompt" },
      },
    });
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
        title: "Inspect the repository",
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

  it("merges native task messages into the Agent tool row", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: (toolUseId) =>
        toolUseId === "agent-call"
          ? { subagent_type: "general-purpose", description: "Review the server" }
          : null,
    });

    const started = tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "native-agent-id",
      tool_use_id: "agent-call",
      task_type: "local_agent",
      subagent_type: "general-purpose",
      prompt: "Inspect the server implementation",
    } as unknown as SDKMessage);
    const output = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "native-agent-id",
        message: { content: [{ type: "text", text: "Found a race condition" }] },
      } as unknown as SDKMessage,
      "native-agent-id",
    );

    expect([...started, ...output]).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "upsert",
        id: "agent-call",
        title: "Review the server",
        description: "Review the server",
        status: "running",
        toolCallId: "agent-call",
      },
    });
    expect([...started, ...output]).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "timeline",
        id: "agent-call",
        item: { type: "user_message", text: "Inspect the server implementation" },
      },
    });
    expect([...started, ...output]).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "timeline",
        id: "agent-call",
        item: { type: "assistant_message", text: "Found a race condition" },
      },
    });
    expect(
      [...started, ...output].every(
        (event) => event.type !== "provider_subagent" || event.event.id !== "native-agent-id",
      ),
    ).toBe(true);
  });

  it("keeps nested Claude agents inside their direct parent's timeline", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => ({
        subagent_type: "general-purpose",
        description: "Review the app",
      }),
    });
    tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "direct-native-id",
      tool_use_id: "direct-agent-call",
      task_type: "local_agent",
      subagent_type: "general-purpose",
      prompt: "Review the app",
    } as unknown as SDKMessage);

    const parentEvents = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "direct-native-id",
        message: {
          content: [
            {
              type: "tool_use",
              id: "nested-agent-call",
              name: "Agent",
              input: { subagent_type: "Explore", prompt: "Review settings" },
            },
          ],
        },
      } as unknown as SDKMessage,
      "direct-native-id",
    );
    const nestedStart = tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "nested-native-id",
      tool_use_id: "nested-agent-call",
      task_type: "local_agent",
      subagent_type: "Explore",
      prompt: "Review settings",
    } as unknown as SDKMessage);
    const nestedOutput = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "nested-native-id",
        message: { content: [{ type: "text", text: "Nested result" }] },
      } as unknown as SDKMessage,
      "nested-native-id",
    );

    expect(parentEvents).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "timeline",
        id: "direct-agent-call",
        item: expect.objectContaining({
          type: "tool_call",
          callId: "nested-agent-call",
          name: "Agent",
          status: "running",
        }),
      },
    });
    expect(nestedStart).toEqual([]);
    expect(nestedOutput).toEqual([]);
  });

  it("removes a nested row if Claude identifies its parent after output starts", () => {
    const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });
    const prematureOutput = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "nested-native-id",
        message: { content: [{ type: "text", text: "Early nested output" }] },
      } as unknown as SDKMessage,
      "nested-native-id",
    );
    expect(prematureOutput).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: expect.objectContaining({ type: "upsert", id: "nested-native-id" }),
    });

    tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "direct-agent-call",
        message: {
          content: [
            {
              type: "tool_use",
              id: "nested-agent-call",
              name: "Agent",
              input: { prompt: "Nested task" },
            },
          ],
        },
      } as unknown as SDKMessage,
      "direct-agent-call",
    );
    const nestedStart = tracker.observeTaskStarted({
      type: "system",
      subtype: "task_started",
      task_id: "nested-native-id",
      tool_use_id: "nested-agent-call",
      task_type: "local_agent",
      subagent_type: "Explore",
      prompt: "Nested task",
    } as unknown as SDKMessage);

    expect(nestedStart).toContainEqual({
      type: "provider_subagent",
      provider: "claude",
      event: { type: "remove", id: "nested-native-id" },
    });
  });
});
