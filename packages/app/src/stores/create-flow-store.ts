import { create } from "zustand";
import type { UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment } from "@getpaseo/protocol/messages";

export type CreateFlowLifecycleState = "active" | "abandoned" | "sent";

export interface PendingCreateAttempt {
  draftId: string;
  serverId: string;
  workspaceId?: string;
  agentId: string | null;
  clientMessageId: string;
  text: string;
  timestamp: number;
  lifecycle: CreateFlowLifecycleState;
  requestStarted: boolean;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

type CreateAttemptInput = Omit<PendingCreateAttempt, "lifecycle" | "requestStarted">;

export function isActiveCreateFlowForDraft(input: {
  pending: PendingCreateAttempt | null | undefined;
  serverId: string;
  draftId: string | null | undefined;
}): boolean {
  const draftId = input.draftId?.trim();
  return Boolean(
    draftId &&
    input.pending?.draftId === draftId &&
    input.pending.serverId === input.serverId &&
    input.pending.lifecycle === "active",
  );
}

interface CreateFlowState {
  pendingByDraftId: Record<string, PendingCreateAttempt>;
  setPending: (pending: CreateAttemptInput) => boolean;
  beginRequest: (pending: CreateAttemptInput) => boolean;
  updateAgentId: (input: { draftId: string; agentId: string }) => void;
  markLifecycle: (input: { draftId: string; lifecycle: CreateFlowLifecycleState }) => void;
  rekeyDraft: (input: { fromDraftId: string; toDraftId: string }) => void;
  clear: (input: { draftId: string }) => void;
  clearByAgent: (input: { serverId: string; agentId: string }) => void;
  clearAll: () => void;
}

export const useCreateFlowStore = create<CreateFlowState>((set, get) => ({
  pendingByDraftId: {},
  setPending: (pending) => {
    const current = get().pendingByDraftId[pending.draftId];
    if (current && current.lifecycle !== "abandoned") {
      return false;
    }
    set((state) => ({
      pendingByDraftId: {
        ...state.pendingByDraftId,
        [pending.draftId]: {
          ...pending,
          lifecycle: "active",
          requestStarted: false,
        },
      },
    }));
    return true;
  },
  beginRequest: (pending) => {
    const current = get().pendingByDraftId[pending.draftId];
    if (
      current &&
      current.lifecycle !== "abandoned" &&
      (current.lifecycle === "sent" ||
        current.requestStarted ||
        current.serverId !== pending.serverId ||
        current.clientMessageId !== pending.clientMessageId)
    ) {
      return false;
    }
    set((state) => ({
      pendingByDraftId: {
        ...state.pendingByDraftId,
        [pending.draftId]: {
          ...(current && current.lifecycle === "active" ? current : pending),
          lifecycle: "active",
          requestStarted: true,
        },
      },
    }));
    return true;
  },
  updateAgentId: ({ draftId, agentId }) =>
    set((state) => {
      const current = state.pendingByDraftId[draftId];
      if (!current || current.agentId === agentId) {
        return state;
      }
      return {
        pendingByDraftId: {
          ...state.pendingByDraftId,
          [draftId]: { ...current, agentId },
        },
      };
    }),
  markLifecycle: ({ draftId, lifecycle }) =>
    set((state) => {
      const current = state.pendingByDraftId[draftId];
      if (!current || current.lifecycle === lifecycle) {
        return state;
      }
      return {
        pendingByDraftId: {
          ...state.pendingByDraftId,
          [draftId]: { ...current, lifecycle },
        },
      };
    }),
  rekeyDraft: ({ fromDraftId, toDraftId }) =>
    set((state) => {
      const current = state.pendingByDraftId[fromDraftId];
      if (!current) {
        return state;
      }
      if (fromDraftId === toDraftId) {
        return state;
      }
      const { [fromDraftId]: _removed, ...rest } = state.pendingByDraftId;
      return {
        pendingByDraftId: {
          ...rest,
          [toDraftId]: { ...current, draftId: toDraftId },
        },
      };
    }),
  clear: ({ draftId }) =>
    set((state) => {
      if (!state.pendingByDraftId[draftId]) {
        return state;
      }
      const { [draftId]: _removed, ...rest } = state.pendingByDraftId;
      return { pendingByDraftId: rest };
    }),
  clearByAgent: ({ serverId, agentId }) =>
    set((state) => {
      const next = Object.fromEntries(
        Object.entries(state.pendingByDraftId).filter(
          ([, pending]) => pending.serverId !== serverId || pending.agentId !== agentId,
        ),
      );
      if (Object.keys(next).length === Object.keys(state.pendingByDraftId).length) {
        return state;
      }
      return { pendingByDraftId: next };
    }),
  clearAll: () => set({ pendingByDraftId: {} }),
}));
