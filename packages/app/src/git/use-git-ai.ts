import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import type { GitAiCommitReviewStatus, GitAiCommitReviewStream } from "@getpaseo/protocol/messages";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { processAgentStreamEvent } from "@/timeline/session-stream-reducers";
import type { StreamItem } from "@/types/stream";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";

type ReviewStatus = "starting" | "running" | "completed" | "failed" | "closing";
type GitReviewAgent = ReturnType<typeof normalizeAgentSnapshot>;
type GitReviewClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

interface GitCommitReviewStartInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  sha: string;
}

export interface GitCommitReviewState {
  taskId: string | null;
  sha: string;
  agent: GitReviewAgent | null;
  streamItems: StreamItem[];
  streamHead: StreamItem[];
  status: ReviewStatus;
  collapsed: boolean;
  error: string | null;
}

export interface GitCommitReviewContext {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}

type ReviewAction =
  | { type: "start"; sha: string }
  | {
      type: "ready";
      taskId: string;
      agent: GitReviewAgent;
    }
  | { type: "stream"; payload: GitAiCommitReviewStream["payload"] }
  | { type: "status"; payload: GitAiCommitReviewStatus["payload"] }
  | { type: "toggle_collapsed" }
  | { type: "closing" }
  | { type: "close_failed"; error: string }
  | { type: "clear" };

type BufferedReviewEvent =
  | { type: "stream"; payload: GitAiCommitReviewStream["payload"] }
  | { type: "status"; payload: GitAiCommitReviewStatus["payload"] };

interface GitCommitReviewStore {
  review: GitCommitReviewState | null;
  context: GitCommitReviewContext | null;
  dispatch: (action: ReviewAction) => void;
  setContext: (context: GitCommitReviewContext) => void;
  clear: () => void;
}

function resolveReviewLifecycle(status: GitAiCommitReviewStatus["payload"]["status"]): {
  reviewStatus: ReviewStatus;
  agentStatus: GitReviewAgent["status"];
} {
  if (status === "running") {
    return { reviewStatus: "running", agentStatus: "running" };
  }
  if (status === "completed") {
    return { reviewStatus: "completed", agentStatus: "idle" };
  }
  return { reviewStatus: "failed", agentStatus: "error" };
}

function reduceReviewState(
  state: GitCommitReviewState | null,
  action: ReviewAction,
): GitCommitReviewState | null {
  if (action.type === "start") {
    return {
      taskId: null,
      sha: action.sha,
      agent: null,
      streamItems: [],
      streamHead: [],
      status: "starting",
      collapsed: false,
      error: null,
    };
  }
  if (action.type === "clear") {
    return null;
  }
  if (!state) {
    return null;
  }
  if (action.type === "ready") {
    return {
      ...state,
      taskId: action.taskId,
      agent: action.agent,
      status: "starting",
      error: null,
    };
  }
  if (action.type === "toggle_collapsed") {
    return { ...state, collapsed: !state.collapsed };
  }
  if (action.type === "closing") {
    return { ...state, status: "closing", error: null };
  }
  if (action.type === "close_failed") {
    return { ...state, status: "failed", error: action.error };
  }
  if (action.payload.taskId !== state.taskId) {
    return state;
  }
  if (action.type === "status") {
    const lifecycle = resolveReviewLifecycle(action.payload.status);
    return {
      ...state,
      status: lifecycle.reviewStatus,
      error: action.payload.error,
      agent: state.agent
        ? {
            ...state.agent,
            status: lifecycle.agentStatus,
            lastError: action.payload.error,
          }
        : null,
    };
  }
  if (!state.agent) {
    return state;
  }
  const timestamp = new Date(action.payload.timestamp);
  // 审查窗口只消费当前连接上的专用实时流，没有历史补页接口；按到达顺序应用事件，
  // 避免普通会话的序号缺口策略在无法补页时永久丢弃后续审查过程。
  const result = processAgentStreamEvent({
    event: action.payload.event,
    seq: undefined,
    epoch: undefined,
    currentTail: state.streamItems,
    currentHead: state.streamHead,
    currentCursor: undefined,
    currentAgent: {
      status: state.agent.status,
      updatedAt: state.agent.updatedAt,
      lastActivityAt: state.agent.lastActivityAt,
    },
    timestamp,
  });
  return {
    ...state,
    streamItems: result.tail,
    streamHead: result.head,
    agent: result.agentChanged && result.agent ? { ...state.agent, ...result.agent } : state.agent,
  };
}

export const useGitCommitReviewStore = create<GitCommitReviewStore>((set) => ({
  review: null,
  context: null,
  dispatch: (action) => set((state) => ({ review: reduceReviewState(state.review, action) })),
  setContext: (context) => set({ context }),
  clear: () => set({ review: null, context: null }),
}));

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let activeClient: GitReviewClient | null = null;
let activeTaskId: string | null = null;
let starting = false;
let closeRequested = false;
let operationToken = 0;
let eventCleanup: (() => void) | null = null;
let connectionCleanup: (() => void) | null = null;
let closeOperation: { taskId: string; promise: Promise<void> } | null = null;
const bufferedEvents = new Map<string, BufferedReviewEvent[]>();

function unsubscribeActiveClient(): void {
  eventCleanup?.();
  connectionCleanup?.();
  eventCleanup = null;
  connectionCleanup = null;
  activeClient = null;
}

function handleActiveClientDisconnected(client: GitReviewClient): void {
  if (activeClient !== client) {
    return;
  }
  operationToken += 1;
  starting = false;
  closeRequested = false;
  unsubscribeActiveClient();
  activeTaskId = null;
  bufferedEvents.clear();
  useGitCommitReviewStore.getState().clear();
}

function subscribeActiveClient(client: NonNullable<typeof activeClient>): boolean {
  unsubscribeActiveClient();
  activeClient = client;
  function applyOrBuffer(event: BufferedReviewEvent): void {
    if (event.payload.taskId === activeTaskId) {
      useGitCommitReviewStore.getState().dispatch(event);
      return;
    }
    if (starting) {
      const queued = bufferedEvents.get(event.payload.taskId) ?? [];
      queued.push(event);
      bufferedEvents.set(event.payload.taskId, queued);
    }
  }
  const unsubscribeStream = client.on("git.ai.commit_review.stream", (message) => {
    applyOrBuffer({ type: "stream", payload: message.payload });
  });
  const unsubscribeStatus = client.on("git.ai.commit_review.status", (message) => {
    applyOrBuffer({ type: "status", payload: message.payload });
  });
  let subscriptionReady = false;
  let disconnectedDuringSubscription = false;
  const unsubscribeConnection = client.subscribeConnectionStatus((status) => {
    if (status.status === "disconnected" || status.status === "disposed") {
      if (!subscriptionReady) {
        disconnectedDuringSubscription = true;
        return;
      }
      handleActiveClientDisconnected(client);
    }
  });
  eventCleanup = () => {
    unsubscribeStream();
    unsubscribeStatus();
  };
  connectionCleanup = unsubscribeConnection;
  subscriptionReady = true;
  if (disconnectedDuringSubscription) {
    handleActiveClientDisconnected(client);
    return false;
  }
  return true;
}

async function closeActiveGitCommitReview(): Promise<void> {
  const taskId = activeTaskId;
  if (!taskId || !activeClient) {
    activeTaskId = null;
    bufferedEvents.clear();
    unsubscribeActiveClient();
    useGitCommitReviewStore.getState().clear();
    return;
  }
  if (closeOperation?.taskId === taskId) {
    await closeOperation.promise;
    return;
  }
  const client = activeClient;
  useGitCommitReviewStore.getState().dispatch({ type: "closing" });
  const promise = (async () => {
    try {
      await client.closeGitCommitReview(taskId);
    } catch (error) {
      if (activeTaskId === taskId && activeClient === client) {
        useGitCommitReviewStore
          .getState()
          .dispatch({ type: "close_failed", error: toErrorMessage(error) });
      }
      throw error;
    }
    bufferedEvents.delete(taskId);
    if (activeTaskId === taskId && activeClient === client) {
      activeTaskId = null;
      unsubscribeActiveClient();
      useGitCommitReviewStore.getState().clear();
    }
  })();
  closeOperation = { taskId, promise };
  try {
    await promise;
  } finally {
    if (closeOperation?.promise === promise) {
      closeOperation = null;
    }
  }
}

export async function closeGitCommitReview(): Promise<void> {
  if (starting) {
    closeRequested = true;
    useGitCommitReviewStore.getState().dispatch({ type: "closing" });
    return;
  }
  await closeActiveGitCommitReview();
}

export function toggleGitCommitReviewCollapsed(): void {
  useGitCommitReviewStore.getState().dispatch({ type: "toggle_collapsed" });
}

export async function startGitCommitReview(
  input: GitCommitReviewStartInput,
  messages: {
    hostDisconnected: string;
    invalidReviewResponse: string;
  } = {
    hostDisconnected: "Host is not connected",
    invalidReviewResponse: "Host returned an invalid commit review response",
  },
): Promise<void> {
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client) {
    throw new Error(messages.hostDisconnected);
  }
  const token = ++operationToken;
  if (activeTaskId || starting) {
    await closeGitCommitReview();
  }
  if (token !== operationToken) {
    return;
  }
  starting = true;
  closeRequested = false;
  const context: GitCommitReviewContext = {
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
  };
  useGitCommitReviewStore.getState().setContext(context);
  useGitCommitReviewStore.getState().dispatch({ type: "start", sha: input.sha });
  if (!subscribeActiveClient(client)) {
    if (token === operationToken) {
      useGitCommitReviewStore.getState().dispatch({
        type: "close_failed",
        error: messages.hostDisconnected,
      });
    }
    throw new Error(messages.hostDisconnected);
  }
  bufferedEvents.clear();
  try {
    const response = await client.startGitCommitReview({
      cwd: input.cwd,
      sha: input.sha,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    });
    if (token !== operationToken) {
      if (response.taskId) {
        await client.closeGitCommitReview(response.taskId);
      }
      return;
    }
    if (!response.taskId || !response.agent) {
      if (response.taskId) {
        await client.closeGitCommitReview(response.taskId);
      }
      throw new Error(messages.invalidReviewResponse);
    }
    activeTaskId = response.taskId;
    starting = false;
    useGitCommitReviewStore.getState().dispatch({
      type: "ready",
      taskId: response.taskId,
      agent: normalizeAgentSnapshot(response.agent, input.serverId),
    });
    const queued = bufferedEvents.get(response.taskId) ?? [];
    bufferedEvents.clear();
    for (const event of queued) {
      useGitCommitReviewStore.getState().dispatch(event);
    }
    if (closeRequested) {
      await closeGitCommitReview();
    }
  } catch (error) {
    starting = false;
    if (token === operationToken) {
      bufferedEvents.clear();
      unsubscribeActiveClient();
      useGitCommitReviewStore
        .getState()
        .dispatch({ type: "close_failed", error: toErrorMessage(error) });
    }
    throw error;
  } finally {
    if (token === operationToken) {
      starting = false;
      closeRequested = false;
    }
  }
}

export function useGitAi({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.gitAi === true,
  );
  const startReview = useCallback(
    async (sha: string) => {
      if (!client) {
        throw new Error(t("workspace.git.ai.errors.hostDisconnected"));
      }
      if (!supported) {
        throw new Error(t("workspace.git.ai.errors.updateHost"));
      }
      await startGitCommitReview(
        { serverId, workspaceId, cwd, sha },
        {
          hostDisconnected: t("workspace.git.ai.errors.hostDisconnected"),
          invalidReviewResponse: t("workspace.git.ai.errors.invalidReviewResponse"),
        },
      );
    },
    [client, cwd, serverId, supported, t, workspaceId],
  );

  const generateCommitMessage = useCallback(async () => {
    if (!client) {
      throw new Error(t("workspace.git.ai.errors.hostDisconnected"));
    }
    if (!supported) {
      throw new Error(t("workspace.git.ai.errors.updateHost"));
    }
    return client.generateGitCommitMessage(cwd);
  }, [client, cwd, supported, t]);

  return {
    supported,
    generateCommitMessage,
    startReview,
  };
}
