export const PRESENCE_THRESHOLD_MS = 180_000;

export interface ClientPresenceState {
  appVisible: boolean;
  appFocused: boolean;
  canShowLocalNotifications: boolean | null;
  lastActivityAtMs: number | null;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
}

export type AttentionFocusTarget = { kind: "agent"; id: string } | { kind: "terminal"; id: string };

export interface NotificationPlan {
  inAppRecipientIndex: number | null;
  shouldPush: boolean;
}

interface ComputeNotificationPlanInput {
  allStates: ClientPresenceState[];
  // A present, app-visible client focused on the attention target suppresses the
  // notification entirely. Pass null when the target should not suppress notifications.
  focusTarget: AttentionFocusTarget | null;
  // Whether a push notification is allowed when no client can receive local attention.
  pushEligible: boolean;
  nowMs: number;
}

function isFocusedOnTarget(
  state: ClientPresenceState,
  target: AttentionFocusTarget | null,
): boolean {
  if (target === null) {
    return false;
  }
  if (target.kind === "agent") {
    return state.focusedAgentId === target.id;
  }
  return state.focusedTerminalId === target.id;
}

export function computeNotificationPlan({
  allStates,
  focusTarget,
  pushEligible,
  nowMs,
}: ComputeNotificationPlanInput): NotificationPlan {
  let mostRecentPresentIndex: number | null = null;
  let mostRecentPresentAtMs = Number.NEGATIVE_INFINITY;
  let mostRecentLocalNotificationIndex: number | null = null;
  let mostRecentLocalNotificationAtMs = Number.NEGATIVE_INFINITY;

  for (const [clientIndex, state] of allStates.entries()) {
    const clampedActivityAtMs =
      state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
    const isPresent =
      clampedActivityAtMs !== null && nowMs - clampedActivityAtMs <= PRESENCE_THRESHOLD_MS;

    const isActivelyUsingApp = state.appVisible && state.appFocused;
    if (isPresent && isActivelyUsingApp && isFocusedOnTarget(state, focusTarget)) {
      return { inAppRecipientIndex: null, shouldPush: false };
    }

    const canReceiveAttention = isActivelyUsingApp || state.canShowLocalNotifications !== false;
    if (isPresent && canReceiveAttention && clampedActivityAtMs > mostRecentPresentAtMs) {
      mostRecentPresentIndex = clientIndex;
      mostRecentPresentAtMs = clampedActivityAtMs;
    }

    if (
      state.canShowLocalNotifications === true &&
      clampedActivityAtMs !== null &&
      clampedActivityAtMs > mostRecentLocalNotificationAtMs
    ) {
      mostRecentLocalNotificationIndex = clientIndex;
      mostRecentLocalNotificationAtMs = clampedActivityAtMs;
    }
  }

  if (mostRecentPresentIndex !== null) {
    return { inAppRecipientIndex: mostRecentPresentIndex, shouldPush: false };
  }

  if (mostRecentLocalNotificationIndex !== null) {
    return { inAppRecipientIndex: mostRecentLocalNotificationIndex, shouldPush: false };
  }

  return { inAppRecipientIndex: null, shouldPush: pushEligible };
}
