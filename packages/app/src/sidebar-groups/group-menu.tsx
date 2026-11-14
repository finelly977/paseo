import { useCallback, useEffect } from "react";
import { Pressable, Text } from "react-native";
import { FolderPlus, FolderInput } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { SIDEBAR_TYPOGRAPHY_DATASET } from "@/styles/sidebar-typography";
import type { Theme } from "@/styles/theme";
import { type ProjectGroup } from "./model";
import { useSidebarGroupsStore } from "./store";

const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedFolderInput = withUnistyles(FolderInput);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export const newGroupIcon = <ThemedFolderPlus size={14} uniProps={iconColor} />;
const moveGroupIcon = <ThemedFolderInput size={14} uniProps={iconColor} />;

export function SidebarGroupsLoader() {
  const loadState = useSidebarGroupsStore((state) => state.loadState);
  const load = useSidebarGroupsStore((state) => state.load);
  const toast = useToast();
  const retry = useCallback(() => {
    void load().catch(() => toast.error("分组读取失败，请重试"));
  }, [load, toast]);
  useEffect(retry, [retry]);
  if (loadState.status !== "error") return null;
  return (
    <Pressable
      onPress={retry}
      accessibilityRole="button"
      testID="sidebar-groups-retry"
      dataSet={SIDEBAR_TYPOGRAPHY_DATASET}
      style={styles.retry}
    >
      <Text style={styles.error}>分组读取失败，重试</Text>
    </Pressable>
  );
}

interface ProjectGroupSubmenuProps {
  projectKey: string;
  onCreate(): void;
}
export function ProjectGroupSubmenu({ projectKey, onCreate }: ProjectGroupSubmenuProps) {
  const project = useSidebarGroupsStore((state) => state.data);
  const ready = useSidebarGroupsStore((state) => state.loadState.status === "ready");
  const pending = useSidebarGroupsStore((state) => state.pending > 0);
  return (
    <DropdownMenuSub openOnHover>
      <DropdownMenuSubTrigger
        leading={moveGroupIcon}
        disabled={!ready || pending}
        testID={`sidebar-project-group-${projectKey}`}
      >
        移至分组
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent testID={`sidebar-project-group-options-${projectKey}`}>
        <ProjectGroupOption
          projectKey={projectKey}
          group={null}
          selected={project.membership[projectKey] === undefined}
        />
        {project.groups.map((group) => (
          <ProjectGroupOption
            key={group.id}
            projectKey={projectKey}
            group={group}
            selected={project.membership[projectKey] === group.id}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={newGroupIcon}
          onSelect={onCreate}
          testID={`sidebar-project-new-group-${projectKey}`}
        >
          新建分组
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface ProjectGroupOptionProps extends Omit<ProjectGroupSubmenuProps, "onCreate"> {
  group: ProjectGroup | null;
  selected: boolean;
}
function ProjectGroupOption({ projectKey, group, selected }: ProjectGroupOptionProps) {
  const pending = useSidebarGroupsStore((state) => state.pending > 0);
  const toast = useToast();
  const select = useCallback(() => {
    void useSidebarGroupsStore
      .getState()
      .assignProject({ projectKey, groupId: group === null ? null : group.id })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "移动分组失败"),
      );
  }, [group, projectKey, toast]);
  return (
    <DropdownMenuItem
      selected={selected}
      disabled={pending}
      onSelect={select}
      testID={`sidebar-project-group-option-${projectKey}-${group === null ? "ungrouped" : group.id}`}
    >
      {group === null ? "未分组" : group.name}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  retry: { padding: 8 },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sidebar },
}));
