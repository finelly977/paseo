import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

interface AgentTimelineMembershipCandidate {
  id: string;
  status: AgentLifecycleStatus;
}

export function selectLiveAgentTimelineIds(
  agents: Iterable<AgentTimelineMembershipCandidate>,
): string[] {
  const agentIds: string[] = [];
  for (const agent of agents) {
    if (agent.status === "initializing" || agent.status === "running") {
      agentIds.push(agent.id);
    }
  }
  return agentIds.sort();
}
