import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useProjectConfigImportPreview } from "@/project-config-import/project-config-import-preview";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import {
  buildConductorMigrationCalloutPolicy,
  buildWorktreeSetupCalloutPolicy,
  selectActiveGitWorkspaceProject,
  shouldShowWorktreeSetupCallout,
} from "./worktree-setup-callout-policy";

export function WorktreeSetupCalloutSource() {
  const selection = useActiveWorkspaceSelection();
  const activeProject = useWorkspaceFields(
    selection?.serverId ?? null,
    selection?.workspaceId ?? null,
    (workspace) => selectActiveGitWorkspaceProject(selection?.serverId ?? "", workspace),
  );
  const client = useHostRuntimeClient(activeProject?.serverId ?? "");
  const supportsConductorImport = useHostFeature(
    activeProject?.serverId,
    "projectConfigImportConductor",
  );
  const callouts = useSidebarCallouts();
  const router = useRouter();
  const openProjectSettings = useStableEvent(
    (route: ReturnType<typeof buildWorktreeSetupCalloutPolicy>["projectSettingsRoute"]) => {
      router.navigate(route);
    },
  );

  const readQuery = useQuery({
    queryKey: ["project-config", activeProject?.serverId ?? "", activeProject?.repoRoot ?? ""],
    queryFn: () => {
      if (!client || !activeProject) {
        throw new Error("Project config query requires an active git workspace");
      }
      return client.readProjectConfig(activeProject.repoRoot);
    },
    enabled: Boolean(client && activeProject),
    retry: false,
  });

  const shouldConsiderSetup = activeProject && shouldShowWorktreeSetupCallout(readQuery.data);
  const importPreviewQuery = useProjectConfigImportPreview({
    client,
    serverId: activeProject?.serverId ?? "",
    repoRoot: activeProject?.repoRoot ?? "",
    source: { kind: "conductor" },
    enabled: Boolean(shouldConsiderSetup && supportsConductorImport),
  });

  const calloutPolicy = useMemo(() => {
    if (!activeProject || !shouldShowWorktreeSetupCallout(readQuery.data)) {
      return null;
    }
    const preview = importPreviewQuery.data;
    if (supportsConductorImport && preview?.ok === true && preview.status === "available") {
      return buildConductorMigrationCalloutPolicy(activeProject, String(Date.now()));
    }
    return buildWorktreeSetupCalloutPolicy(activeProject);
  }, [activeProject, importPreviewQuery.data, readQuery.data, supportsConductorImport]);

  useEffect(() => {
    if (!calloutPolicy) {
      return;
    }

    return callouts.show({
      id: calloutPolicy.id,
      dismissalKey: calloutPolicy.dismissalKey,
      priority: calloutPolicy.priority,
      title: calloutPolicy.title,
      description: calloutPolicy.description,
      actions: [
        {
          label: calloutPolicy.actionLabel,
          onPress: () => openProjectSettings(calloutPolicy.projectSettingsRoute),
          variant: "primary",
        },
      ],
      testID: calloutPolicy.testID,
    });
  }, [calloutPolicy, callouts, openProjectSettings]);

  return null;
}
