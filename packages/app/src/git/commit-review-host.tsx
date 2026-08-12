import { useCallback, useMemo } from "react";
import { CommitReviewPane } from "@/git/commit-review-pane";
import {
  closeGitCommitReview,
  toggleGitCommitReviewCollapsed,
  useGitCommitReviewStore,
} from "@/git/use-git-ai";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import type { PendingPermission } from "@/types/shared";
import { createWorkspaceFileTabTarget, type WorkspaceFileOpenRequest } from "@/workspace/file-open";

const EMPTY_PENDING_PERMISSIONS = new Map<string, PendingPermission>();

export function CommitReviewHost() {
  const review = useGitCommitReviewStore((state) => state.review);
  const context = useGitCommitReviewStore((state) => state.context);
  const allPendingPermissions = useSessionStore((state) =>
    context ? state.sessions[context.serverId]?.pendingPermissions : undefined,
  );
  const pendingPermissions = useMemo(() => {
    if (!review?.agent || !allPendingPermissions) {
      return EMPTY_PENDING_PERMISSIONS;
    }
    const filtered = new Map<string, PendingPermission>();
    for (const [key, permission] of allPendingPermissions) {
      if (permission.agentId === review.agent.id) {
        filtered.set(key, permission);
      }
    }
    return filtered.size > 0 ? filtered : EMPTY_PENDING_PERMISSIONS;
  }, [allPendingPermissions, review?.agent]);
  const handleOpenWorkspaceFile = useCallback(
    function openWorkspaceFile(request: WorkspaceFileOpenRequest) {
      if (!context) {
        return;
      }
      navigateToWorkspace({
        serverId: context.serverId,
        workspaceId: context.workspaceId ?? context.cwd,
        target: createWorkspaceFileTabTarget(request.location),
      });
    },
    [context],
  );

  if (!review || !context) {
    return null;
  }

  return (
    <CommitReviewPane
      review={review}
      serverId={context.serverId}
      pendingPermissions={pendingPermissions}
      onToggleCollapsed={toggleGitCommitReviewCollapsed}
      onClose={closeGitCommitReview}
      onOpenWorkspaceFile={handleOpenWorkspaceFile}
    />
  );
}
