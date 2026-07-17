import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import SettingsScreen from "@/screens/settings-screen";
import { parseProjectConfigImportIntent } from "@/project-config-import/project-config-import-model";

export default function SettingsProjectDetailRoute() {
  const params = useLocalSearchParams<{
    projectKey?: string | string[];
    importSource?: string | string[];
    importServerId?: string | string[];
    importIntentId?: string | string[];
  }>();
  const rawProjectKey = Array.isArray(params.projectKey) ? params.projectKey[0] : params.projectKey;
  const projectKey = typeof rawProjectKey === "string" ? decodeURIComponent(rawProjectKey) : "";
  const importIntent = useMemo(() => parseProjectConfigImportIntent(params), [params]);
  const view = useMemo(
    () => ({ kind: "project" as const, projectKey, importIntent }),
    [importIntent, projectKey],
  );

  return <SettingsScreen view={view} />;
}
