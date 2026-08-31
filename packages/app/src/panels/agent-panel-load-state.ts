import type { AgentScreenMissingState } from "@/hooks/use-agent-screen-state-machine";
import type { Agent } from "@/stores/session-store";

export function shouldResumeClosedRuntimeOnPaneEntry(input: {
  visibleEntryKey: string | null;
  previousVisibleEntryKey: string | null;
  status: Agent["status"] | null;
}): boolean {
  return Boolean(
    input.visibleEntryKey &&
    input.visibleEntryKey !== input.previousVisibleEntryKey &&
    input.status === "closed",
  );
}
export function shouldInitializeAgentPane(input: {
  hasAgentRecord: boolean;
  hasAuthoritativeHistory: boolean;
  shouldResumeClosedRuntime: boolean;
}): boolean {
  return !input.hasAgentRecord || !input.hasAuthoritativeHistory || input.shouldResumeClosedRuntime;
}

export function reconcileMissingAgentStateWithPresentAgent(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "resolving" || state.kind === "not_found") {
    return { kind: "idle" };
  }
  return state;
}

export function clearHistorySyncErrorAfterSuccessfulSync(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "error") {
    return { kind: "idle" };
  }
  return state;
}
