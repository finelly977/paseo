import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { RewindMode } from "./use-rewind-capabilities";
import { useRewindComposerRestore } from "./composer-restore";
import { useSessionStore } from "@/stores/session-store";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";
import { clearOptimisticUserMessages } from "@/types/stream";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { UserMessageImageAttachment } from "@/types/stream";
import { planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import { runConversationRewind } from "./rewind-operation";

interface UseRewindAgentMutationInput {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  client?: DaemonClient | null;
}

interface RewindAgentInput {
  mode: RewindMode;
  rewoundText: string;
  rewoundImages: UserMessageImageAttachment[];
}

export function useRewindAgentMutation(input: UseRewindAgentMutationInput): {
  rewindAgent: (input: RewindAgentInput) => Promise<void>;
  isPending: boolean;
} {
  const toast = useToast();
  const { t } = useTranslation();
  const composerRestore = useRewindComposerRestore();
  const { isPending, mutateAsync } = useMutation({
    mutationFn: async ({ mode, rewoundText, rewoundImages }: RewindAgentInput) => {
      const { client, agentId, messageId, serverId } = input;
      if (!client || !agentId || !messageId) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      if (!shouldRestoreComposerForRewindMode(mode)) {
        await client.rewindAgent(agentId, messageId, mode);
        return;
      }
      if (!serverId) throw new Error(t("common.errors.daemonClientUnavailable"));
      await runConversationRewind({
        rewind: () => client.rewindAgent(agentId, messageId, mode),
        apply: () => {
          const store = useSessionStore.getState();
          const session = store.sessions[serverId];
          store.setAgentStreamState(serverId, agentId, {
            tail: clearOptimisticUserMessages(session?.agentStreamTail.get(agentId) ?? []),
            head: clearOptimisticUserMessages(session?.agentStreamHead.get(agentId) ?? []),
          });
          composerRestore?.restoreDraftIfComposerEmpty({
            text: rewoundText,
            attachments: rewoundImages.map((metadata) => ({ kind: "image", metadata })),
          });
        },
        refreshTimeline: () =>
          getHostRuntimeStore().fetchAgentTimeline(serverId, agentId, planTimelineTailFetch()),
        onRefreshError: (error) => {
          console.error("消息已撤回，刷新历史失败", error);
          toast.error("消息已撤回，输入框内容已保留；历史刷新失败，请重新加载会话。");
        },
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("rewind.errors.failed"));
    },
  });

  const rewindAgent = useCallback(
    async (rewindInput: RewindAgentInput) => {
      if (isPending) {
        return;
      }
      await mutateAsync(rewindInput);
    },
    [isPending, mutateAsync],
  );

  return {
    rewindAgent,
    isPending,
  };
}
