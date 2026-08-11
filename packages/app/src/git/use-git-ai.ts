import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GitAiCommitReviewStatus, GitAiCommitReviewStream } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { processAgentStreamEvent } from "@/timeline/session-stream-reducers";
import type { StreamItem } from "@/types/stream";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";

type ReviewStatus = "starting" | "running" | "completed" | "failed" | "closing";
type GitReviewAgent = ReturnType<typeof normalizeAgentSnapshot>;

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const [review, dispatch] = useReducer(reduceReviewState, null);
  const activeTaskIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const operationBusyRef = useRef(false);
  const operationTokenRef = useRef(0);
  const closeRequestedRef = useRef(false);
  const bufferedEventsRef = useRef(new Map<string, BufferedReviewEvent[]>());

  useEffect(() => {
    if (!client) {
      return;
    }
    const applyOrBuffer = (event: BufferedReviewEvent) => {
      if (event.payload.taskId === activeTaskIdRef.current) {
        dispatch(event);
        return;
      }
      if (!startingRef.current) {
        return;
      }
      const buffered = bufferedEventsRef.current.get(event.payload.taskId) ?? [];
      buffered.push(event);
      bufferedEventsRef.current.set(event.payload.taskId, buffered);
    };
    const unsubscribeStream = client.on("git.ai.commit_review.stream", (message) => {
      applyOrBuffer({ type: "stream", payload: message.payload });
    });
    const unsubscribeStatus = client.on("git.ai.commit_review.status", (message) => {
      applyOrBuffer({ type: "status", payload: message.payload });
    });
    return () => {
      unsubscribeStream();
      unsubscribeStatus();
    };
  }, [client]);

  useEffect(
    () => () => {
      operationTokenRef.current += 1;
      operationBusyRef.current = false;
      closeRequestedRef.current = false;
      const taskId = activeTaskIdRef.current;
      startingRef.current = false;
      bufferedEventsRef.current.clear();
      dispatch({ type: "clear" });
      if (!client || !taskId) {
        return;
      }
      activeTaskIdRef.current = null;
      void client.closeGitCommitReview(taskId).catch((error) => {
        console.error("[Git AI] 卸载面板时清理提交审查失败", error);
      });
    },
    [client, cwd, workspaceId],
  );

  const closeActiveTask = useCallback(
    async (taskId: string) => {
      if (!client) {
        throw new Error(t("workspace.git.ai.errors.hostDisconnected"));
      }
      dispatch({ type: "closing" });
      try {
        await client.closeGitCommitReview(taskId);
      } catch (error) {
        const message = toErrorMessage(error);
        if (activeTaskIdRef.current === taskId) {
          dispatch({ type: "close_failed", error: message });
        }
        throw error;
      }
      bufferedEventsRef.current.delete(taskId);
      if (activeTaskIdRef.current === taskId) {
        activeTaskIdRef.current = null;
        dispatch({ type: "clear" });
      }
    },
    [client, t],
  );

  const startReview = useCallback(
    async (sha: string) => {
      if (!client) {
        throw new Error(t("workspace.git.ai.errors.hostDisconnected"));
      }
      if (!supported) {
        throw new Error(t("workspace.git.ai.errors.updateHost"));
      }
      if (operationBusyRef.current) {
        throw new Error(t("workspace.git.ai.errors.operationInProgress"));
      }
      operationBusyRef.current = true;
      closeRequestedRef.current = false;
      const operationToken = operationTokenRef.current + 1;
      operationTokenRef.current = operationToken;
      try {
        const activeTaskId = activeTaskIdRef.current;
        if (activeTaskId) {
          await closeActiveTask(activeTaskId);
        }

        dispatch({ type: "start", sha });
        startingRef.current = true;
        bufferedEventsRef.current.clear();
        const response = await client.startGitCommitReview({
          cwd,
          sha,
          ...(workspaceId ? { workspaceId } : {}),
        });
        if (!response.taskId || !response.agent) {
          throw new Error(t("workspace.git.ai.errors.invalidReviewResponse"));
        }
        const taskId = response.taskId;
        if (operationTokenRef.current !== operationToken) {
          await client.closeGitCommitReview(taskId);
          return;
        }
        activeTaskIdRef.current = taskId;
        startingRef.current = false;
        dispatch({
          type: "ready",
          taskId,
          agent: normalizeAgentSnapshot(response.agent, serverId),
        });
        const buffered = bufferedEventsRef.current.get(taskId) ?? [];
        bufferedEventsRef.current.clear();
        for (const event of buffered) {
          dispatch(event);
        }
        if (closeRequestedRef.current) {
          await closeActiveTask(taskId);
        }
      } catch (error) {
        startingRef.current = false;
        if (operationTokenRef.current === operationToken && !activeTaskIdRef.current) {
          dispatch({ type: "close_failed", error: toErrorMessage(error) });
        }
        throw error;
      } finally {
        if (operationTokenRef.current === operationToken) {
          operationBusyRef.current = false;
          closeRequestedRef.current = false;
        }
      }
    },
    [client, closeActiveTask, cwd, serverId, supported, t, workspaceId],
  );

  const closeReview = useCallback(async () => {
    if (operationBusyRef.current && startingRef.current) {
      closeRequestedRef.current = true;
      dispatch({ type: "closing" });
      return;
    }
    const taskId = activeTaskIdRef.current;
    if (!taskId) {
      dispatch({ type: "clear" });
      return;
    }
    if (operationBusyRef.current) {
      return;
    }
    const operationToken = operationTokenRef.current + 1;
    operationTokenRef.current = operationToken;
    operationBusyRef.current = true;
    try {
      await closeActiveTask(taskId);
    } finally {
      if (operationTokenRef.current === operationToken) {
        operationBusyRef.current = false;
      }
    }
  }, [closeActiveTask]);

  const toggleReviewCollapsed = useCallback(() => {
    dispatch({ type: "toggle_collapsed" });
  }, []);

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
    review,
    generateCommitMessage,
    startReview,
    closeReview,
    toggleReviewCollapsed,
  };
}
