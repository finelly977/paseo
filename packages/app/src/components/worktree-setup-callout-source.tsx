import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useProjectConfigImportAvailability } from "@/project-config-import/use-project-config-import-model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import {
  buildProjectConfigImportCalloutPolicy,
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
  const importAvailability = useProjectConfigImportAvailability({
    client,
    serverId: activeProject?.serverId,
    repoRoot: activeProject?.repoRoot,
    enabled: Boolean(shouldConsiderSetup),
  });
  const calloutPolicy = useMemo(() => {
    if (!activeProject || !shouldShowWorktreeSetupCallout(readQuery.data)) {
      return null;
    }
    if (importAvailability.status === "loading") {
      return null;
    }
    if (importAvailability.status === "one" && importAvailability.source) {
      return buildProjectConfigImportCalloutPolicy(activeProject, {
        status: "one",
        sourceDisplayName: importAvailability.source.module.displayName,
        sourceRouteValue: importAvailability.source.module.routeValue,
        intentId: String(Date.now()),
      });
    }
    if (importAvailability.status === "many") {
      return buildProjectConfigImportCalloutPolicy(activeProject, { status: "many" });
    }
    return buildWorktreeSetupCalloutPolicy(activeProject);
  }, [activeProject, importAvailability.source, importAvailability.status, readQuery.data]);

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
