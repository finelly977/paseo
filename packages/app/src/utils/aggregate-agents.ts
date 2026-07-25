import equal from "fast-deep-equal";
import type { Agent } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";

export interface AggregatedAgent extends AgentDirectoryEntry {
  serverId: string;
  serverLabel: string;
}

function appendAgentWithNativeDedup(
  agents: AggregatedAgent[],
  nativeIndex: Map<string, number>,
  agent: AggregatedAgent,
  nativeSessionId: string | null,
): void {
  const nativeKey = nativeSessionId ? `${agent.serverId}:${nativeSessionId}` : null;
  if (!nativeKey) {
    agents.push(agent);
    return;
  }
  const previousIndex = nativeIndex.get(nativeKey);
  if (previousIndex === undefined) {
    nativeIndex.set(nativeKey, agents.length);
    agents.push(agent);
    return;
  }
  const previous = agents[previousIndex];
  if (!previous || previous.lastActivityAt < agent.lastActivityAt) {
    agents[previousIndex] = agent;
  }
}

export function collectAggregatedAgents(input: {
  sessionAgents: Record<string, Map<string, Agent> | undefined>;
  serverLabelById: ReadonlyMap<string, string>;
  includeArchived: boolean;
  previousById: ReadonlyMap<string, AggregatedAgent>;
}): AggregatedAgent[] {
  const collected: AggregatedAgent[] = [];
  const nativeCodexAgentIndex = new Map<string, number>();
  for (const [serverId, agents] of Object.entries(input.sessionAgents)) {
    if (!agents) continue;
    const serverLabel = input.serverLabelById.get(serverId) ?? serverId;
    for (const agent of agents.values()) {
      if (!input.includeArchived && agent.archivedAt) continue;
      const nextAgent: AggregatedAgent = {
        id: agent.id,
        serverId,
        serverLabel,
        title: agent.title ?? null,
        status: agent.status,
        lastActivityAt: agent.lastActivityAt,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId,
        provider: agent.provider,
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
        attentionTimestamp: agent.attentionTimestamp,
        archivedAt: agent.archivedAt,
        createdAt: agent.createdAt,
        labels: agent.labels,
        projectPlacement: agent.projectPlacement,
      };
      const previous = input.previousById.get(`${serverId}:${agent.id}`);
      appendAgentWithNativeDedup(
        collected,
        nativeCodexAgentIndex,
        previous !== undefined && equal(previous, nextAgent) ? previous : nextAgent,
        agent.provider === "codex"
          ? (agent.persistence?.nativeHandle ??
              agent.persistence?.sessionId ??
              agent.runtimeInfo?.sessionId ??
              null)
          : null,
      );
    }
  }
  return collected;
}
