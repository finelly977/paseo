import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { ChevronRight, Folder, MoreHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { GestureType } from "react-native-gesture-handler";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { DisclosureChevron, DisclosureContent } from "@/components/ui/disclosure";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebarRowHover } from "@/components/sidebar/use-sidebar-row-hover";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { partitionProjects, type ProjectGroup } from "./model";
import { useSidebarGroupsStore } from "./store";

const ThemedChevron = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedMore = withUnistyles(MoreHorizontal);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const NOOP_DRAG = () => {};
const projectKey = (project: SidebarProjectEntry) => project.projectKey;

interface GroupedProjectListProps {
  projects: SidebarProjectEntry[];
  reorderEnabled: boolean;
  renderItem(info: DraggableRenderItemInfo<SidebarProjectEntry>): React.ReactElement;
  onReorder(projects: SidebarProjectEntry[]): void;
  extraData: string;
  nestable: boolean;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}
export function GroupedProjectList(props: GroupedProjectListProps) {
  const data = useSidebarGroupsStore((state) => state.data);
  const sections = useMemo(() => partitionProjects(data, props.projects), [data, props.projects]);
  const reorder = useCallback(
    (next: SidebarProjectEntry[]) => {
      const keys = new Set(next.map(projectKey));
      let index = 0;
      props.onReorder(
        props.projects.map((project) => (keys.has(project.projectKey) ? next[index++] : project)),
      );
    },
    [props],
  );
  return (
    <View>
      {sections.groups.map((group, index) => (
        <ProjectGroupSection
          key={group.id}
          {...props}
          group={group}
          collapsed={group.collapsed}
          projects={group.projects}
          index={index}
          groupCount={sections.groups.length}
          onReorder={reorder}
        />
      ))}
      {sections.ungrouped.length > 0 ? (
        <ProjectGroupSection
          {...props}
          group={null}
          collapsed={data.ungroupedCollapsed}
          projects={sections.ungrouped}
          index={0}
          groupCount={0}
          onReorder={reorder}
        />
      ) : null}
    </View>
  );
}

interface ProjectGroupSectionProps extends GroupedProjectListProps {
  group: ProjectGroup | null;
  collapsed: boolean;
  index: number;
  groupCount: number;
}
function ProjectGroupSection({
  group,
  collapsed,
  index,
  groupCount,
  projects,
  reorderEnabled,
  renderItem,
  onReorder,
  extraData,
  nestable,
  parentGestureRef,
}: ProjectGroupSectionProps) {
  const { isHovered, hoverHandlers, revalidateHover } = useSidebarRowHover();
  const compact = useIsCompactFormFactor();
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const toast = useToast();
  const pending = useSidebarGroupsStore((state) => state.pending > 0);
  const name = group === null ? "未分组" : group.name;
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const id = group === null ? "ungrouped" : group.id;
  const menuVisible = isHovered || isNative || compact || menuOpen || focused;
  const actionStyle = useMemo(() => [styles.action, !menuVisible && styles.hidden], [menuVisible]);
  const reportError = useCallback(
    (error: unknown) => toast.error(error instanceof Error ? error.message : "分组保存失败"),
    [toast],
  );
  const toggle = useCallback(() => {
    void useSidebarGroupsStore
      .getState()
      .toggleCollapsed(group === null ? null : group.id)
      .catch(reportError);
  }, [group, reportError]);
  const openRename = useCallback(
    () => useSidebarGroupsStore.getState().openDialog({ projectKey: null, group }),
    [group],
  );
  const moveUp = useCallback(() => {
    if (group)
      void useSidebarGroupsStore
        .getState()
        .reorderGroup({ groupId: group.id, offset: -1 })
        .catch(reportError);
  }, [group, reportError]);
  const moveDown = useCallback(() => {
    if (group)
      void useSidebarGroupsStore
        .getState()
        .reorderGroup({ groupId: group.id, offset: 1 })
        .catch(reportError);
  }, [group, reportError]);
  const remove = useCallback(() => {
    if (!group) return;
    void confirmDialog({
      title: `删除“${group.name}”？`,
      message: "工作区会移至未分组，不会删除。",
      confirmLabel: "删除分组",
      cancelLabel: "取消",
      destructive: true,
    })
      .then((confirmed) =>
        confirmed ? useSidebarGroupsStore.getState().removeGroup(group.id) : undefined,
      )
      .catch(reportError);
  }, [group, reportError]);
  const onMenuChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (!open) revalidateHover();
    },
    [revalidateHover],
  );
  return (
    <View style={styles.section} testID={`sidebar-custom-group-${id}`}>
      <View style={styles.header} {...hoverHandlers}>
        <Pressable
          style={headerStyle}
          onPress={toggle}
          onFocus={onFocus}
          onBlur={onBlur}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityState={accessibilityState}
          testID={`sidebar-group-toggle-${id}`}
        >
          <DisclosureChevron expanded={!collapsed}>
            <ThemedChevron size={12} uniProps={iconColor} />
          </DisclosureChevron>
          <ThemedFolder size={13} uniProps={iconColor} />
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text dataSet={COMPACT_LABEL_DATASET} style={styles.count}>
            {projects.length}
          </Text>
        </Pressable>
        {group ? (
          <View style={actionStyle} pointerEvents={menuVisible ? "auto" : "none"}>
            <DropdownMenu typography="sidebar" compact onOpenChange={onMenuChange}>
              <DropdownMenuTrigger
                onFocus={onFocus}
                onBlur={onBlur}
                accessibilityLabel={`${name}分组操作`}
                style={styles.more}
                testID={`sidebar-group-menu-${id}`}
              >
                <ThemedMore size={14} uniProps={iconColor} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width={180}>
                <DropdownMenuItem onSelect={openRename} disabled={pending}>
                  重命名分组
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={moveUp} disabled={pending || index === 0}>
                  上移
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={moveDown}
                  disabled={pending || index === groupCount - 1}
                >
                  下移
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={remove} disabled={pending} destructive>
                  删除分组
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
      </View>
      <DisclosureContent expanded={!collapsed}>
        {() => (
          <View style={styles.members}>
            {reorderEnabled ? (
              <DraggableList
                data={projects}
                keyExtractor={projectKey}
                renderItem={renderItem}
                onDragEnd={onReorder}
                extraData={extraData}
                useDragHandle
                scrollEnabled={false}
                nestable={nestable}
                simultaneousGestureRef={parentGestureRef}
                testID={`sidebar-group-members-${id}`}
              />
            ) : (
              projects.map((item, itemIndex) => (
                <View key={item.projectKey}>
                  {renderItem({ item, index: itemIndex, drag: NOOP_DRAG, isActive: false })}
                </View>
              ))
            )}
            {projects.length === 0 ? <Text style={styles.empty}>暂无工作区</Text> : null}
          </View>
        )}
      </DisclosureContent>
    </View>
  );
}

function headerStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.toggle, (hovered || pressed) && styles.hovered];
}
const styles = StyleSheet.create((theme) => ({
  section: { marginTop: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    paddingLeft: 14,
    minHeight: { xs: 44, md: 30 },
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    minHeight: { xs: 44, md: 30 },
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 5,
    borderRadius: theme.borderRadius.md,
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundSidebar,
    fontSize: theme.fontSize.sidebar,
  },
  count: {
    fontSize: theme.fontSize.base * 0.75,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 3,
  },
  action: { width: { xs: 44, md: 28 }, alignItems: "center" },
  hidden: { opacity: 0 },
  more: {
    minWidth: { xs: 44, md: 28 },
    minHeight: { xs: 44, md: 28 },
    alignItems: "center",
    justifyContent: "center",
  },
  members: { paddingLeft: 12 },
  empty: {
    fontSize: theme.fontSize.sidebar,
    color: theme.colors.foregroundMuted,
    paddingVertical: 6,
    paddingLeft: 32,
  },
}));
