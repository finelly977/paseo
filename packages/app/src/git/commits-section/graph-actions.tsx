import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import type { CheckoutCommitReference } from "@getpaseo/protocol/messages";
import {
  ArrowDownUp,
  ChevronDown,
  Cloud,
  CloudDownload,
  Download,
  GitBranch,
  ListFilter,
  LocateFixed,
  MoreHorizontal,
  RefreshCcw,
  Tag,
  Upload,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import type { GitAction, GitActionId, GitActions } from "@/git/policy";
import type { CheckoutCommitRefFilter } from "@/git/use-commits-query";

interface GraphActionsProps {
  gitActions: GitActions;
  availableRefs: CheckoutCommitReference[];
  filter: CheckoutCommitRefFilter;
  onFilterChange: (filter: CheckoutCommitRefFilter) => void;
  onLocateHead: () => void;
  canLocateHead: boolean;
  fetchSupported: boolean;
  hasRemote: boolean;
  isFetching: boolean;
  onFetch: () => void;
  refreshSupported: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

type GraphActionKind = "fetch" | "pull" | "push" | "refresh" | "locate";

interface GraphActionButtonProps {
  kind: GraphActionKind;
  label: string;
  pending?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedCloud = withUnistyles(Cloud);
const ThemedCloudDownload = withUnistyles(CloudDownload);
const ThemedDownload = withUnistyles(Download);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedListFilter = withUnistyles(ListFilter);
const ThemedLocateFixed = withUnistyles(LocateFixed);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedTag = withUnistyles(Tag);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);

const iconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

function buttonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.button, (Boolean(hovered) || pressed) && styles.buttonActive];
}

function GraphActionIcon({ kind }: { kind: GraphActionKind }) {
  switch (kind) {
    case "fetch":
      return <ThemedCloudDownload size={14} uniProps={iconColorMapping} />;
    case "pull":
      return <ThemedDownload size={14} uniProps={iconColorMapping} />;
    case "push":
      return <ThemedUpload size={14} uniProps={iconColorMapping} />;
    case "refresh":
      return <ThemedRefreshCcw size={14} uniProps={iconColorMapping} />;
    case "locate":
      return <ThemedLocateFixed size={14} uniProps={iconColorMapping} />;
  }
}

function GraphActionButton({
  kind,
  label,
  pending = false,
  disabled = false,
  onPress,
}: GraphActionButtonProps) {
  const accessibilityState = useMemo(
    () => ({ disabled: pending || disabled }),
    [disabled, pending],
  );
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      ...buttonStyle(state),
      disabled && styles.buttonDisabled,
    ],
    [disabled],
  );
  const handlePress = useCallback(() => {
    if (!pending && !disabled) {
      onPress();
    }
  }, [disabled, onPress, pending]);
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={accessibilityState}
          onPress={handlePress}
          style={pressableStyle}
          testID={`git-graph-action-${kind}`}
        >
          {pending ? (
            <ThemedActivityIndicator size={12} uniProps={iconColorMapping} />
          ) : (
            <GraphActionIcon kind={kind} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={6}>
        <Text style={styles.tooltipLabel}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function GitGraphActionButton({ kind, action }: { kind: "pull" | "push"; action: GitAction }) {
  const toast = useToast();
  const pending = action.status === "pending";
  const handlePress = useCallback(() => {
    if (action.unavailableMessage) {
      toast.show(action.unavailableMessage, { durationMs: 3200 });
      return;
    }
    action.handler();
  }, [action, toast]);

  return (
    <GraphActionButton
      kind={kind}
      label={pending ? action.pendingLabel : action.label}
      pending={pending}
      disabled={action.disabled && !action.unavailableMessage}
      onPress={handlePress}
    />
  );
}

function ReferenceMenuIcon({ kind }: { kind: CheckoutCommitReference["kind"] }) {
  switch (kind) {
    case "head":
      return <ThemedLocateFixed size={14} uniProps={iconColorMapping} />;
    case "branch":
      return <ThemedGitBranch size={14} uniProps={iconColorMapping} />;
    case "remote":
      return <ThemedCloud size={14} uniProps={iconColorMapping} />;
    case "tag":
      return <ThemedTag size={14} uniProps={iconColorMapping} />;
  }
}

function GraphRefFilter({
  availableRefs,
  filter,
  onFilterChange,
}: {
  availableRefs: CheckoutCommitReference[];
  filter: CheckoutCommitRefFilter;
  onFilterChange: (filter: CheckoutCommitRefFilter) => void;
}) {
  const { t } = useTranslation();
  const selectedRefs = useMemo(() => (filter.mode === "selected" ? filter.refs : []), [filter]);
  let label = t("workspace.git.diff.commits.filterAuto");
  if (filter.mode === "all") {
    label = t("workspace.git.diff.commits.filterAll");
  } else if (filter.mode === "selected") {
    label = t("workspace.git.diff.commits.filterCount", { count: filter.refs.length });
  }
  const handleAutoSelect = useCallback(() => onFilterChange({ mode: "auto" }), [onFilterChange]);
  const handleAllSelect = useCallback(() => onFilterChange({ mode: "all" }), [onFilterChange]);
  const handleReferenceSelect = useCallback(
    (id: string) => {
      const current = new Set(selectedRefs);
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      const refs = availableRefs
        .filter((reference) => current.has(reference.id))
        .map((reference) => reference.id);
      onFilterChange(refs.length > 0 ? { mode: "selected", refs } : { mode: "auto" });
    },
    [availableRefs, onFilterChange, selectedRefs],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel={t("workspace.git.diff.commits.filterLabel")}
        style={buttonStyle}
        testID="git-graph-ref-filter"
      >
        <ThemedListFilter size={13} uniProps={iconColorMapping} />
        <Text style={styles.filterLabel} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevronDown size={11} uniProps={iconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260} scrollable maxHeight={420}>
        <DropdownMenuItem
          selected={filter.mode === "auto"}
          showSelectedCheck
          onSelect={handleAutoSelect}
        >
          {t("workspace.git.diff.commits.filterAuto")}
        </DropdownMenuItem>
        <DropdownMenuItem
          selected={filter.mode === "all"}
          showSelectedCheck
          onSelect={handleAllSelect}
        >
          {t("workspace.git.diff.commits.filterAll")}
        </DropdownMenuItem>
        {availableRefs.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("workspace.git.diff.commits.references")}</DropdownMenuLabel>
            {availableRefs.map((reference) => (
              <ReferenceFilterItem
                key={reference.id}
                reference={reference}
                selected={selectedRefs.includes(reference.id)}
                onSelect={handleReferenceSelect}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReferenceFilterItem({
  reference,
  selected,
  onSelect,
}: {
  reference: CheckoutCommitReference;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const leading = useMemo(() => <ReferenceMenuIcon kind={reference.kind} />, [reference.kind]);
  const handleSelect = useCallback(() => onSelect(reference.id), [onSelect, reference.id]);
  return (
    <DropdownMenuItem
      closeOnSelect={false}
      leading={leading}
      selected={selected}
      showSelectedCheck
      onSelect={handleSelect}
    >
      {reference.name}
    </DropdownMenuItem>
  );
}

function findAction(gitActions: GitActions, id: GitActionId): GitAction | undefined {
  return [
    ...(gitActions.primary ? [gitActions.primary] : []),
    ...gitActions.secondary,
    ...gitActions.menu,
  ].find((action) => action.id === id);
}

function MoreActions({ gitActions }: { gitActions: GitActions }) {
  const { t } = useTranslation();
  const actions = useMemo(
    () =>
      [findAction(gitActions, "pull-and-push")].filter((action): action is GitAction =>
        Boolean(action),
      ),
    [gitActions],
  );
  if (actions.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel={t("workspace.git.diff.commits.moreActions")}
        style={buttonStyle}
        testID="git-graph-more-actions"
      >
        <ThemedMoreHorizontal size={14} uniProps={iconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" minWidth={210}>
        {actions.map((action) => (
          <MoreActionItem key={action.id} action={action} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreActionIcon({ id }: { id: GitActionId }) {
  switch (id) {
    case "pull":
      return <ThemedDownload size={14} uniProps={iconColorMapping} />;
    case "push":
      return <ThemedUpload size={14} uniProps={iconColorMapping} />;
    case "pull-and-push":
      return <ThemedArrowDownUp size={14} uniProps={iconColorMapping} />;
    default:
      return null;
  }
}

function MoreActionItem({ action }: { action: GitAction }) {
  const toast = useToast();
  const leading = useMemo(() => <MoreActionIcon id={action.id} />, [action.id]);
  const handleSelect = useCallback(() => {
    if (action.unavailableMessage) {
      toast.show(action.unavailableMessage, { durationMs: 3200 });
      return;
    }
    action.handler();
  }, [action, toast]);
  return (
    <DropdownMenuItem
      disabled={action.disabled && !action.unavailableMessage}
      leading={leading}
      status={action.status === "pending" ? "pending" : undefined}
      onSelect={handleSelect}
    >
      {action.label}
    </DropdownMenuItem>
  );
}

export function GraphActions({
  gitActions,
  availableRefs,
  filter,
  onFilterChange,
  onLocateHead,
  canLocateHead,
  fetchSupported,
  hasRemote,
  isFetching,
  onFetch,
  refreshSupported,
  isRefreshing,
  onRefresh,
}: GraphActionsProps) {
  const { t } = useTranslation();
  const pullAction = findAction(gitActions, "pull");
  const pushAction = findAction(gitActions, "push");
  return (
    <View style={styles.container}>
      <GraphRefFilter
        availableRefs={availableRefs}
        filter={filter}
        onFilterChange={onFilterChange}
      />
      <GraphActionButton
        kind="locate"
        label={t("workspace.git.diff.commits.locateHead")}
        disabled={!canLocateHead}
        onPress={onLocateHead}
      />
      {fetchSupported ? (
        <GraphActionButton
          kind="fetch"
          label={t("workspace.git.diff.commits.fetch")}
          pending={isFetching}
          disabled={!hasRemote || isFetching}
          onPress={onFetch}
        />
      ) : null}
      {pullAction ? <GitGraphActionButton kind="pull" action={pullAction} /> : null}
      {pushAction ? <GitGraphActionButton kind="push" action={pushAction} /> : null}
      {refreshSupported ? (
        <GraphActionButton
          kind="refresh"
          label={t("workspace.git.diff.refresh")}
          pending={isRefreshing}
          disabled={isRefreshing}
          onPress={onRefresh}
        />
      ) : null}
      <MoreActions gitActions={gitActions} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
    gap: 1,
  },
  button: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: theme.borderRadius.base,
  },
  buttonActive: {
    backgroundColor: theme.colors.surface2,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  filterLabel: {
    maxWidth: 68,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.popoverForeground,
    fontWeight: theme.fontWeight.medium,
  },
}));
