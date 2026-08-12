import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "@getpaseo/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

const getClient = vi.fn();

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getClient }),
  useHostRuntimeClient: () => null,
}));

import { closeGitCommitReview, startGitCommitReview, useGitCommitReviewStore } from "./use-git-ai";

type ReviewStreamListener = (message: {
  type: "git.ai.commit_review.stream";
  payload: {
    taskId: string;
    timestamp: string;
    event: { type: "text_delta"; delta: string };
  };
}) => void;

type ReviewStatusListener = (message: {
  type: "git.ai.commit_review.status";
  payload: {
    taskId: string;
    status: "running" | "completed" | "failed";
    error: string | null;
  };
}) => void;

class FakeGitReviewClient {
  state: ConnectionState = { status: "connected" };
  startResponse: Promise<{ taskId: string | null; agent: AgentSnapshotPayload | null }> =
    Promise.resolve({ taskId: "review-1", agent: createAgentSnapshot() });
  closeResponse: Promise<void> = Promise.resolve();
  closeCalls: string[] = [];
  streamListeners = new Set<ReviewStreamListener>();
  statusListeners = new Set<ReviewStatusListener>();
  connectionListeners = new Set<(state: ConnectionState) => void>();

  on(type: string, listener: ReviewStreamListener | ReviewStatusListener): () => void {
    if (type === "git.ai.commit_review.stream") {
      this.streamListeners.add(listener as ReviewStreamListener);
      return () => this.streamListeners.delete(listener as ReviewStreamListener);
    }
    this.statusListeners.add(listener as ReviewStatusListener);
    return () => this.statusListeners.delete(listener as ReviewStatusListener);
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.state);
    return () => this.connectionListeners.delete(listener);
  }

  startGitCommitReview(): Promise<{
    taskId: string | null;
    agent: AgentSnapshotPayload | null;
  }> {
    return this.startResponse;
  }

  closeGitCommitReview(taskId: string): Promise<void> {
    this.closeCalls.push(taskId);
    return this.closeResponse;
  }
}

function createAgentSnapshot(): AgentSnapshotPayload {
  const timestamp = "2026-08-12T00:00:00.000Z";
  return {
    id: "review-agent",
    provider: "codex",
    status: "running",
    createdAt: timestamp,
    updatedAt: timestamp,
    capabilities: [],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: null,
    lastUsage: null,
    model: null,
    lastUserMessageAt: null,
    title: null,
    cwd: "E:/repo",
    workspaceId: "workspace-1",
    features: [],
    labels: {},
  } as unknown as AgentSnapshotPayload;
}

async function resetReviewState(): Promise<void> {
  try {
    await closeGitCommitReview();
  } catch {
    useGitCommitReviewStore.getState().clear();
  }
  getClient.mockReset();
}

afterEach(resetReviewState);

describe("global Git commit review lifecycle", () => {
  it("keeps the review alive without a mounted Git panel hook", async () => {
    const client = new FakeGitReviewClient();
    getClient.mockReturnValue(client);

    await startGitCommitReview({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "E:/repo",
      sha: "abc123",
    });

    expect(useGitCommitReviewStore.getState()).toMatchObject({
      review: { taskId: "review-1", sha: "abc123" },
      context: { serverId: "server-1", workspaceId: "workspace-1", cwd: "E:/repo" },
    });
    expect(client.streamListeners.size).toBe(1);
    expect(client.statusListeners.size).toBe(1);
  });

  it("waits for an in-flight close before starting the replacement review", async () => {
    const firstClient = new FakeGitReviewClient();
    getClient.mockReturnValue(firstClient);
    await startGitCommitReview({ serverId: "server-1", cwd: "E:/repo", sha: "first" });

    let finishClose: (() => void) | undefined;
    firstClient.closeResponse = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const secondClient = new FakeGitReviewClient();
    secondClient.startResponse = Promise.resolve({
      taskId: "review-2",
      agent: createAgentSnapshot(),
    });
    getClient.mockReturnValue(secondClient);

    const closePromise = closeGitCommitReview();
    const replacementPromise = startGitCommitReview({
      serverId: "server-1",
      cwd: "E:/repo",
      sha: "second",
    });
    await Promise.resolve();

    expect(firstClient.closeCalls).toEqual(["review-1"]);
    expect(secondClient.streamListeners.size).toBe(0);

    finishClose?.();
    await closePromise;
    await replacementPromise;

    expect(useGitCommitReviewStore.getState().review).toMatchObject({
      taskId: "review-2",
      sha: "second",
    });
  });

  it("clears the application-level review when its host disconnects", async () => {
    const client = new FakeGitReviewClient();
    getClient.mockReturnValue(client);
    await startGitCommitReview({ serverId: "server-1", cwd: "E:/repo", sha: "abc123" });

    for (const listener of client.connectionListeners) {
      listener({ status: "disconnected", reason: "network_error" });
    }

    expect(useGitCommitReviewStore.getState().review).toBeNull();
    expect(client.streamListeners.size).toBe(0);
    expect(client.statusListeners.size).toBe(0);
  });
});
