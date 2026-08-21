import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import {
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";
import { buildToolCallDisplayModel } from "@getpaseo/protocol/tool-call-display";

import type { AgentMetadata, AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";

interface ClaudeContentChunk {
  type: string;
  [key: string]: unknown;
}

interface SubAgentActionEntry {
  index: number;
  toolName: string;
  input: unknown;
  summary?: string;
}

interface SubAgentActivityState {
  name?: string;
  subAgentType?: string;
  description?: string;
  actions: SubAgentActionEntry[];
  actionKeys: string[];
  nextActionIndex: number;
  actionIndexByKey: Map<string, number>;
  completedActionKeys: Set<string>;
}

interface SubAgentActionCandidate {
  key: string;
  toolName: string;
  input: unknown;
}

interface ClaudeTaskStartedMessage {
  type: "system";
  subtype: "task_started";
  task_id?: unknown;
  tool_use_id?: unknown;
  task_type?: unknown;
  subagent_type?: unknown;
  description?: unknown;
  prompt?: unknown;
  skip_transcript?: unknown;
}

const MAX_SUB_AGENT_LOG_ENTRIES = 200;
const MAX_SUB_AGENT_SUMMARY_CHARS = 160;

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isClaudeContentChunk(value: unknown): value is ClaudeContentChunk {
  return Boolean(
    value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string",
  );
}

export class ClaudeSidechainTracker {
  private readonly activeSidechains = new Map<string, SubAgentActivityState>();
  private readonly canonicalSidechainIdByTaskId = new Map<string, string>();
  private readonly canonicalSidechainIdByToolUseId = new Map<string, string>();
  private readonly contextBySidechainId = new Map<
    string,
    Pick<SubAgentActivityState, "name" | "subAgentType" | "description">
  >();
  private readonly getToolInput: (toolUseId: string) => AgentMetadata | null | undefined;

  constructor(input: { getToolInput: (toolUseId: string) => AgentMetadata | null | undefined }) {
    this.getToolInput = input.getToolInput;
  }

  handleMessage(message: SDKMessage, parentToolUseId: string): AgentStreamEvent[] {
    const canonicalId = this.resolveSidechainId(parentToolUseId);
    const state = this.getOrCreateSidechainState(canonicalId);

    const contextUpdated = this.updateSubAgentContextFromTaskInput(state, canonicalId);
    const actionCandidates = this.extractSubAgentActionCandidates(message);
    const childTimelineItems = [
      ...this.extractSubAgentTimelineItems(message),
      ...this.extractSubAgentToolResults(message, state),
    ];
    let actionUpdated = false;
    for (const action of actionCandidates) {
      if (state.completedActionKeys.has(action.key)) continue;
      if (this.appendSubAgentAction(state, action)) {
        actionUpdated = true;
        const toolCall = mapClaudeRunningToolCall({
          name: action.toolName,
          callId: action.key,
          input: action.input,
          output: null,
        });
        if (toolCall) {
          childTimelineItems.push(toolCall);
        }
      }
    }

    if (!contextUpdated && !actionUpdated && childTimelineItems.length === 0) {
      return [];
    }

    const toolCall = mapClaudeRunningToolCall({
      name: "Task",
      callId: canonicalId,
      input: null,
      output: null,
    });
    if (!toolCall) {
      return [];
    }

    const detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"] = {
      type: "sub_agent",
      ...(state.subAgentType ? { subAgentType: state.subAgentType } : {}),
      ...(state.description ? { description: state.description } : {}),
      log: state.actions
        .map((action) =>
          action.summary ? `[${action.toolName}] ${action.summary}` : `[${action.toolName}]`,
        )
        .join("\n"),
      actions: [],
    };

    return [
      {
        type: "provider_subagent",
        provider: "claude",
        event: {
          type: "upsert",
          id: canonicalId,
          title: state.name ?? state.subAgentType ?? "Claude subagent",
          description: state.description ?? null,
          status: "running",
          toolCallId: canonicalId,
        },
      },
      ...childTimelineItems.map(
        (item): AgentStreamEvent => ({
          type: "provider_subagent",
          provider: "claude",
          event: { type: "timeline", id: canonicalId, item },
        }),
      ),
      {
        type: "timeline",
        item: {
          ...toolCall,
          detail,
        },
        provider: "claude",
      },
    ];
  }

  observeTaskStarted(message: SDKMessage): AgentStreamEvent[] {
    const task = message as unknown as ClaudeTaskStartedMessage;
    if (task.type !== "system" || task.subtype !== "task_started") return [];
    const taskId = readTrimmedString(task.task_id);
    const toolUseId = readTrimmedString(task.tool_use_id);
    const taskType = readTrimmedString(task.task_type);
    const subAgentType = readTrimmedString(task.subagent_type);
    const isSubagent = taskType ? taskType === "local_agent" : subAgentType !== undefined;
    if (!taskId || !toolUseId || task.skip_transcript === true || !isSubagent) return [];

    const existingId = this.canonicalSidechainIdByTaskId.get(taskId);
    if (!existingId) {
      this.canonicalSidechainIdByTaskId.set(taskId, toolUseId);
      this.canonicalSidechainIdByToolUseId.set(toolUseId, toolUseId);
      this.rememberSubAgentContext(toolUseId, task);
      return [];
    }

    this.canonicalSidechainIdByToolUseId.set(toolUseId, existingId);
    const state = this.getOrCreateSidechainState(existingId);
    this.updateSubAgentContextFromTaskInput(state, existingId);
    const events: AgentStreamEvent[] = [
      {
        type: "provider_subagent",
        provider: "claude",
        event: {
          type: "upsert",
          id: existingId,
          title: state.name ?? state.subAgentType ?? "Claude subagent",
          description: state.description ?? null,
          status: "running",
          toolCallId: existingId,
        },
      },
    ];
    const prompt = readTrimmedString(task.prompt);
    if (prompt) {
      events.push({
        type: "provider_subagent",
        provider: "claude",
        event: {
          type: "timeline",
          id: existingId,
          item: { type: "user_message", text: prompt },
        },
      });
    }
    return events;
  }

  finishAll(status: "completed" | "failed" | "canceled"): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    for (const [id, state] of this.activeSidechains) {
      events.push({
        type: "provider_subagent",
        provider: "claude",
        event: {
          type: "upsert",
          id,
          title: state.name ?? state.subAgentType ?? "Claude subagent",
          description: state.description ?? null,
          status,
          toolCallId: id,
        },
      });
    }
    this.activeSidechains.clear();
    return events;
  }

  finish(id: string, status: "completed" | "failed" | "canceled"): AgentStreamEvent[] {
    const canonicalId = this.resolveSidechainId(id);
    const state = this.activeSidechains.get(canonicalId);
    if (!state) return [];
    this.activeSidechains.delete(canonicalId);
    return [
      {
        type: "provider_subagent",
        provider: "claude",
        event: {
          type: "upsert",
          id: canonicalId,
          title: state.name ?? state.subAgentType ?? "Claude subagent",
          description: state.description ?? null,
          status,
          toolCallId: canonicalId,
        },
      },
    ];
  }

  delete(toolUseId: string): void {
    this.activeSidechains.delete(this.resolveSidechainId(toolUseId));
  }

  clear(): void {
    this.activeSidechains.clear();
  }

  resetSession(): void {
    this.clear();
    this.canonicalSidechainIdByTaskId.clear();
    this.canonicalSidechainIdByToolUseId.clear();
    this.contextBySidechainId.clear();
  }

  private resolveSidechainId(toolUseId: string): string {
    return this.canonicalSidechainIdByToolUseId.get(toolUseId) ?? toolUseId;
  }

  private getOrCreateSidechainState(id: string): SubAgentActivityState {
    const existing = this.activeSidechains.get(id);
    if (existing) return existing;
    const context = this.contextBySidechainId.get(id);
    const state = {
      ...context,
      actions: [],
      actionKeys: [],
      nextActionIndex: 1,
      actionIndexByKey: new Map<string, number>(),
      completedActionKeys: new Set<string>(),
    } satisfies SubAgentActivityState;
    this.activeSidechains.set(id, state);
    return state;
  }

  private extractSubAgentTimelineItems(message: SDKMessage): AgentTimelineItem[] {
    if (message.type !== "assistant" || !Array.isArray(message.message?.content)) {
      return [];
    }
    const messageId = readTrimmedString(message.message.id);
    const items: AgentTimelineItem[] = [];
    for (const block of message.message.content) {
      if (!isClaudeContentChunk(block)) continue;
      if (block.type === "text") {
        const text = readTrimmedString(block.text);
        if (text) {
          items.push({
            type: "assistant_message",
            text,
            ...(messageId ? { messageId } : {}),
          });
        }
      } else if (block.type === "thinking") {
        const text = readTrimmedString(block.thinking);
        if (text) items.push({ type: "reasoning", text });
      }
    }
    return items;
  }

  private extractSubAgentToolResults(
    message: SDKMessage,
    state: SubAgentActivityState,
  ): AgentTimelineItem[] {
    const messageRecord = message as unknown as Record<string, unknown>;
    const messageContainer = messageRecord.message as Record<string, unknown> | undefined;
    const content = messageContainer?.content;
    if (!Array.isArray(content)) return [];

    const items: AgentTimelineItem[] = [];
    for (const block of content) {
      if (!isClaudeContentChunk(block) || !block.type.endsWith("tool_result")) continue;
      const callId = readTrimmedString(block.tool_use_id);
      if (!callId || state.completedActionKeys.has(callId)) continue;
      const actionIndex = state.actionIndexByKey.get(callId);
      const action = actionIndex === undefined ? undefined : state.actions[actionIndex];
      const toolName = action?.toolName ?? readTrimmedString(block.tool_name);
      if (!toolName) continue;
      const params = {
        name: toolName,
        callId,
        input: action?.input ?? null,
        output: block.content ?? null,
      };
      const toolCall = block.is_error
        ? mapClaudeFailedToolCall({ ...params, error: block })
        : mapClaudeCompletedToolCall(params);
      if (toolCall) {
        state.completedActionKeys.add(callId);
        items.push(toolCall);
      }
    }
    return items;
  }

  private updateSubAgentContextFromTaskInput(
    state: SubAgentActivityState,
    parentToolUseId: string,
  ): boolean {
    const context = this.rememberSubAgentContext(parentToolUseId);

    let changed = false;
    if (context.name && context.name !== state.name) {
      state.name = context.name;
      changed = true;
    }
    if (context.subAgentType && context.subAgentType !== state.subAgentType) {
      state.subAgentType = context.subAgentType;
      changed = true;
    }
    if (context.description && context.description !== state.description) {
      state.description = context.description;
      changed = true;
    }
    return changed;
  }

  private rememberSubAgentContext(
    sidechainId: string,
    task?: ClaudeTaskStartedMessage,
  ): Pick<SubAgentActivityState, "name" | "subAgentType" | "description"> {
    const existing = this.contextBySidechainId.get(sidechainId) ?? {};
    const taskInput = this.getToolInput(sidechainId);
    const context = {
      name: existing.name ?? this.normalizeSubAgentText(taskInput?.name),
      subAgentType:
        existing.subAgentType ??
        this.normalizeSubAgentText(taskInput?.subagent_type) ??
        this.normalizeSubAgentText(task?.subagent_type),
      description:
        existing.description ??
        this.normalizeSubAgentText(taskInput?.description) ??
        this.normalizeSubAgentText(task?.description),
    };
    this.contextBySidechainId.set(sidechainId, context);
    return context;
  }

  private normalizeSubAgentText(value: unknown): string | undefined {
    const normalized = readTrimmedString(value)?.replace(/\s+/g, " ");
    if (!normalized) {
      return undefined;
    }
    if (normalized.length <= MAX_SUB_AGENT_SUMMARY_CHARS) {
      return normalized;
    }
    return `${normalized.slice(0, MAX_SUB_AGENT_SUMMARY_CHARS)}...`;
  }

  private extractAssistantMessageActions(
    message: Extract<SDKMessage, { type: "assistant" }>,
  ): SubAgentActionCandidate[] {
    const content = message.message?.content;
    if (!Array.isArray(content)) {
      return [];
    }
    const actions: SubAgentActionCandidate[] = [];
    for (const block of content) {
      if (
        !isClaudeContentChunk(block) ||
        !(
          block.type === "tool_use" ||
          block.type === "mcp_tool_use" ||
          block.type === "server_tool_use"
        ) ||
        typeof block.name !== "string"
      ) {
        continue;
      }
      const key = readTrimmedString(block.id) ?? `assistant:${block.name}:${actions.length}`;
      actions.push({
        key,
        toolName: block.name,
        input: block.input ?? null,
      });
    }
    return actions;
  }

  private extractStreamEventActions(
    message: Extract<SDKMessage, { type: "stream_event" }>,
  ): SubAgentActionCandidate[] {
    const event = message.event;
    if (event.type !== "content_block_start") {
      return [];
    }
    const block = isClaudeContentChunk(event.content_block) ? event.content_block : null;
    if (
      !block ||
      !(
        block.type === "tool_use" ||
        block.type === "mcp_tool_use" ||
        block.type === "server_tool_use"
      ) ||
      typeof block.name !== "string"
    ) {
      return [];
    }
    const key =
      readTrimmedString(block.id) ??
      `stream:${block.name}:${typeof event.index === "number" ? event.index : 0}`;
    return [
      {
        key,
        toolName: block.name,
        input: block.input ?? null,
      },
    ];
  }

  private extractSubAgentActionCandidates(message: SDKMessage): SubAgentActionCandidate[] {
    if (message.type === "assistant") {
      return this.extractAssistantMessageActions(message);
    }

    if (message.type === "stream_event") {
      return this.extractStreamEventActions(message);
    }

    if (message.type === "tool_progress") {
      const toolName = readTrimmedString(message.tool_name);
      if (!toolName) {
        return [];
      }
      const key = readTrimmedString(message.tool_use_id) ?? `progress:${toolName}`;
      return [{ key, toolName, input: null }];
    }

    return [];
  }

  private appendSubAgentAction(
    state: SubAgentActivityState,
    candidate: SubAgentActionCandidate,
  ): boolean {
    const normalizedToolName = readTrimmedString(candidate.toolName);
    if (!normalizedToolName) {
      return false;
    }

    const summary = this.deriveSubAgentActionSummary(normalizedToolName, candidate.input);
    const existingIndex = state.actionIndexByKey.get(candidate.key);

    if (existingIndex !== undefined) {
      const existing = state.actions[existingIndex];
      if (!existing) {
        return false;
      }
      const nextSummary = existing.summary ?? summary;
      if (existing.toolName === normalizedToolName && existing.summary === nextSummary) {
        return false;
      }
      state.actions[existingIndex] = {
        ...existing,
        toolName: normalizedToolName,
        input: existing.input ?? candidate.input,
        ...(nextSummary ? { summary: nextSummary } : {}),
      };
      return true;
    }

    state.actions.push({
      index: state.nextActionIndex,
      toolName: normalizedToolName,
      input: candidate.input,
      ...(summary ? { summary } : {}),
    });
    state.nextActionIndex += 1;
    state.actionKeys.push(candidate.key);
    this.trimSubAgentTail(state);
    this.rebuildSubAgentActionIndex(state);
    return true;
  }

  private trimSubAgentTail(state: SubAgentActivityState): void {
    while (state.actions.length > MAX_SUB_AGENT_LOG_ENTRIES) {
      state.actions.shift();
      const removedKey = state.actionKeys.shift();
      if (removedKey) state.completedActionKeys.delete(removedKey);
    }
  }

  private rebuildSubAgentActionIndex(state: SubAgentActivityState): void {
    state.actionIndexByKey.clear();
    for (let index = 0; index < state.actionKeys.length; index += 1) {
      const key = state.actionKeys[index];
      if (key) {
        state.actionIndexByKey.set(key, index);
      }
    }
  }

  private deriveSubAgentActionSummary(toolName: string, input: unknown): string | undefined {
    const runningToolCall = mapClaudeRunningToolCall({
      name: toolName,
      callId: `sub-agent-summary-${toolName}`,
      input,
      output: null,
    });
    if (!runningToolCall) {
      return undefined;
    }
    const display = buildToolCallDisplayModel({
      name: runningToolCall.name,
      status: runningToolCall.status,
      error: runningToolCall.error,
      detail: runningToolCall.detail,
      metadata: runningToolCall.metadata,
    });
    return this.normalizeSubAgentText(display.summary);
  }
}
