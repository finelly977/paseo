import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import SettingsScreen from "@/screens/settings-screen";
import { parseProjectConfigImportIntent } from "@/project-config-import/route";
import { projectConfigImportSourceRegistry } from "@/project-config-import/sources";

export default function SettingsProjectDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    projectKey?: string | string[];
    importSource?: string | string[];
    importServerId?: string | string[];
    importIntentId?: string | string[];
  }>();
  const rawProjectKey = Array.isArray(params.projectKey) ? params.projectKey[0] : params.projectKey;
  const projectKey = typeof rawProjectKey === "string" ? decodeURIComponent(rawProjectKey) : "";
  const importIntent = useMemo(
    () => parseProjectConfigImportIntent(params, projectConfigImportSourceRegistry),
    [params],
  );
  const handleImportIntentConsumed = useCallback(() => {
    router.setParams({
      importSource: undefined,
      importServerId: undefined,
      importIntentId: undefined,
    });
  }, [router]);
  const view = useMemo(
    () => ({
      kind: "project" as const,
      projectKey,
      importIntent,
      onImportIntentConsumed: handleImportIntentConsumed,
    }),
    [handleImportIntentConsumed, importIntent, projectKey],
  );

  return <SettingsScreen view={view} />;
}
