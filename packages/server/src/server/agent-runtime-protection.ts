interface ClientActivityReader {
  getClientActivity(): { focusedAgentId: string | null } | null;
  getViewedTimelineAgentIds(): Iterable<string>;
}

export function collectRuntimeProtectedAgentIds(input: {
  scheduledAgentIds: Iterable<string>;
  sessions: Iterable<ClientActivityReader>;
}): Set<string> {
  const protectedAgentIds = new Set(input.scheduledAgentIds);
  for (const session of input.sessions) {
    const activity = session.getClientActivity();
    if (activity?.focusedAgentId) {
      protectedAgentIds.add(activity.focusedAgentId);
    }
    for (const agentId of session.getViewedTimelineAgentIds()) {
      protectedAgentIds.add(agentId);
    }
  }
  return protectedAgentIds;
}
