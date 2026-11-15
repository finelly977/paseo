import { useCallback, useMemo, useState, type MutableRefObject, type ReactNode } from "react";
import { View, Text, Pressable, type PressableStateCallbackType } from "react-native";
import { ChevronRight, MoreHorizontal } from "lucide-react-native";
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
import { isNative, isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { partitionProjects, getGroupOrder, type ProjectGroup } from "./model";
import { useSidebarGroupsStore } from "./store";

const ThemedChevron = withUnistyles(ChevronRight);
const GROUP_HOLD_DELAY_MS = 220;
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
interface GroupSection {
  id: string;
  group: ProjectGroup | null;
  projects: SidebarProjectEntry[];
  collapsed: boolean;
}
type GroupSortState =
  | { status: "idle" | "dragging" }
  | { status: "saving"; order: (string | null)[] }
  | { status: "error"; order: (string | null)[]; message: string };
const groupKey = (section: GroupSection) => section.id;

export function GroupedProjectList(props: GroupedProjectListProps) {
  const data = useSidebarGroupsStore((state) => state.data);
  const [sort, setSort] = useState<GroupSortState>({ status: "idle" });
  const sections = useMemo(() => {
    const partition = partitionProjects(data, props.projects);
    const byId = new Map(partition.groups.map((group) => [group.id, group]));
    const order = sort.status === "saving" ? sort.order : getGroupOrder(data);
    return order.map((id): GroupSection => {
      if (id === null)
        return {
          id: "ungrouped",
          group: null,
          projects: partition.ungrouped,
          collapsed: data.ungroupedCollapsed,
        };
      const group = byId.get(id);
      if (!group) throw new Error("工作区分组不存在");
      return { id, group, projects: group.projects, collapsed: group.collapsed };
    });
  }, [data, props.projects, sort]);
  const reorderProjects = useCallback(
    (next: SidebarProjectEntry[]) => {
      const keys = new Set(next.map(projectKey));
      let index = 0;
      props.onReorder(
        props.projects.map((project) => (keys.has(project.projectKey) ? next[index++] : project)),
      );
    },
    [props],
  );
  const saveOrder = useCallback((order: (string | null)[]) => {
    setSort({ status: "saving", order });
    void useSidebarGroupsStore
      .getState()
      .setGroupOrder(order)
      .then(() => setSort({ status: "idle" }))
      .catch((error: unknown) =>
        setSort({
          status: "error",
          order,
          message:
            error instanceof Error && error.name === "QuotaExceededError"
              ? "本地存储空间不足，排序未保存"
              : "排序未保存",
        }),
      );
  }, []);
  const reorder = useCallback(
    (next: GroupSection[]) => {
      const order = next.map((section) => (section.group === null ? null : section.id));
      const current = getGroupOrder(data);
      if (order.every((id, index) => id === current[index])) return;
      saveOrder(order);
    },
    [saveOrder, data],
  );
  const retry = useCallback(() => {
    if (sort.status === "error") saveOrder(sort.order);
  }, [sort, saveOrder]);
  const begin = useCallback(() => setSort({ status: "dragging" }), []);
  const release = useCallback(
    () => setSort((current) => (current.status === "dragging" ? { status: "idle" } : current)),
    [],
  );
  const renderSection = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<GroupSection>) => (
      <ProjectGroupSection
        {...props}
        projects={item.projects}
        group={item.group}
        collapsed={item.collapsed}
        onReorder={reorderProjects}
        sorting={sort.status === "dragging"}
        drag={drag}
        dragging={isActive}
        dragHandleProps={dragHandleProps}
      />
    ),
    [props, reorderProjects, sort.status],
  );
  return (
    <View>
      {sort.status === "error" ? (
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          testID="sidebar-groups-order-retry"
          style={styles.sortError}
        >
          <Text style={styles.sortErrorText}>{sort.message}，重试</Text>
        </Pressable>
      ) : null}
      <DraggableList
        data={sections}
        keyExtractor={groupKey}
        renderItem={renderSection}
        onDragEnd={reorder}
        onDragBegin={begin}
        onDragRelease={release}
        scrollEnabled={false}
        useDragHandle
        holdDelayMs={GROUP_HOLD_DELAY_MS}
        nestable={props.nestable}
        simultaneousGestureRef={props.parentGestureRef}
        testID="sidebar-custom-groups"
      />
    </View>
  );
}

interface ProjectGroupSectionProps extends GroupedProjectListProps {
  group: ProjectGroup | null;
  collapsed: boolean;
  sorting: boolean;
  dragging: boolean;
  drag: () => void;
  dragHandleProps?: DraggableRenderItemInfo<GroupSection>["dragHandleProps"];
}
function ProjectGroupSection({
  group,
  collapsed,
  projects,
  reorderEnabled,
  renderItem,
  onReorder,
  extraData,
  nestable,
  parentGestureRef,
  sorting,
  dragging,
  drag,
  dragHandleProps,
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
      <View style={[styles.header, pending && styles.pending]} {...hoverHandlers}>
        <View
          style={[styles.headerBackground, dragging && styles.draggingHeader]}
          pointerEvents="none"
        />
        <GroupHeaderToggle
          name={name}
          id={id}
          pending={pending}
          drag={drag}
          dragHandleProps={dragHandleProps}
          onPress={toggle}
          onFocus={onFocus}
          onBlur={onBlur}
          expanded={!collapsed}
          hovered={isHovered}
        >
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text dataSet={COMPACT_LABEL_DATASET} style={styles.count}>
            {projects.length}
          </Text>
          <DisclosureChevron expanded={!collapsed}>
            <ThemedChevron size={12} uniProps={iconColor} />
          </DisclosureChevron>
        </GroupHeaderToggle>
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={remove} disabled={pending} destructive>
                  删除分组
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
      </View>
      <View style={sorting ? styles.sortingMembers : undefined}>
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
    </View>
  );
}

interface GroupHeaderToggleProps {
  id: string;
  name: string;
  pending: boolean;
  drag(): void;
  dragHandleProps?: DraggableRenderItemInfo<GroupSection>["dragHandleProps"];
  onFocus(): void;
  onBlur(): void;
  onPress(): void;
  expanded: boolean;
  hovered: boolean;
  children: ReactNode;
}
function GroupHeaderToggle({
  id,
  name,
  pending,
  drag,
  dragHandleProps,
  onFocus,
  onBlur,
  onPress,
  expanded,
  hovered,
  children,
}: GroupHeaderToggleProps) {
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return isWeb ? (
    <View
      {...dragHandleProps?.attributes}
      {...(pending ? undefined : dragHandleProps?.listeners)}
      ref={dragHandleProps?.setActivatorNodeRef}
      style={[styles.toggle, hovered && styles.hovered]}
      onClick={pending ? undefined : onPress}
      aria-expanded={expanded}
      onFocus={onFocus}
      onBlur={onBlur}
      accessibilityRole="button"
      accessibilityLabel={name}
      aria-disabled={pending}
      tabIndex={pending ? -1 : 0}
      testID={`sidebar-group-toggle-${id}`}
    >
      {children}
    </View>
  ) : (
    <Pressable
      onLongPress={drag}
      delayLongPress={GROUP_HOLD_DELAY_MS}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={pending}
      style={headerStyle}
      accessibilityState={accessibilityState}
      accessibilityRole="button"
      accessibilityLabel={name}
      testID={`sidebar-group-toggle-${id}`}
    >
      {children}
    </Pressable>
  );
}

function headerStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.toggle, (hovered || pressed) && styles.hovered];
}
const styles = StyleSheet.create((theme) => ({
  pending: { opacity: 0.6 },
  sortingMembers: { display: "none" },
  headerBackground: { position: "absolute", inset: 0, borderRadius: theme.borderRadius.md },
  draggingHeader: { backgroundColor: theme.colors.surfaceSidebarHover },
  sortError: { padding: theme.spacing[2] },
  sortErrorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sidebar },
  section: { marginTop: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    minHeight: { xs: 48, md: 24 },
  },
  toggle: {
    flex: 1,
    minWidth: 0,
    minHeight: { xs: 48, md: 24 },
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: theme.spacing[2],
    userSelect: "none",
    borderRadius: theme.borderRadius.md,
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundSidebar,
    fontSize: theme.fontSize.sidebar * 0.875,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0.2,
  },
  count: {
    fontSize: theme.fontSize.base * 0.75,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 3,
  },
  action: { width: { xs: 48, md: 24 }, flexDirection: "row", alignItems: "center" },
  hidden: { opacity: 0 },
  more: {
    minWidth: { xs: 48, md: 24 },
    minHeight: { xs: 48, md: 24 },
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
