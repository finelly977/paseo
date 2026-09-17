import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { Button } from "@/components/ui/button";
import { isNative } from "@/constants/platform";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveAgentProfileDisplayName } from "../internal/profile-summary";
import { useAgentProfiles } from "../internal/use-agent-profiles";
import type { AgentProfileValue } from "../internal/profile-form-model";
import { AgentProfileEditModal } from "./agent-profile-edit-modal";
import { AgentProfileRow } from "./agent-profile-row";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

function generateAgentProfileId(): string {
  return `agent_profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function profileKey(profile: AgentProfile): string {
  return profile.id;
}

function hasSameProfileOrder(
  first: readonly AgentProfile[],
  second: readonly AgentProfile[],
): boolean {
  return (
    first.length === second.length &&
    first.every((profile, index) => profile.id === second[index]?.id)
  );
}

interface EditTarget {
  mode: "create" | "edit";
  profile?: AgentProfile;
}

export function AgentProfilesSection({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { profiles, isSupported, saveProfiles } = useAgentProfiles(serverId);
  const { entries } = useProvidersSnapshot(serverId, { cwd: null });
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [orderedProfiles, setOrderedProfiles] = useState<AgentProfile[]>(() => profiles ?? []);
  const [isReordering, setIsReordering] = useState(false);

  useEffect(() => {
    setOrderedProfiles(profiles ?? []);
  }, [profiles]);

  const handleAddOpen = useCallback(() => setEditTarget({ mode: "create" }), []);
  const handleEditClose = useCallback(() => setEditTarget(null), []);

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = orderedProfiles.find((entry) => entry.id === id);
      if (!profile) {
        return;
      }
      setEditTarget({ mode: "edit", profile });
    },
    [orderedProfiles],
  );

  const handleSave = useCallback(
    async (value: AgentProfileValue) => {
      const current = orderedProfiles;
      const editing = editTarget?.mode === "edit" ? editTarget.profile : undefined;
      // The edited profile is replaced, not merged: `value` omits the fields the
      // user cleared, so spreading it over the stored record would silently keep
      // the old model, mode, thinking option or notes.
      const next: AgentProfile[] = editing
        ? current.map((entry) => (entry.id === editing.id ? { id: entry.id, ...value } : entry))
        : [...current, { id: generateAgentProfileId(), ...value }];
      await saveProfiles(next);
      setOrderedProfiles(next);
    },
    [editTarget, orderedProfiles, saveProfiles],
  );

  const persistOrder = useCallback(
    async (next: AgentProfile[]) => {
      if (isReordering || hasSameProfileOrder(orderedProfiles, next)) {
        return;
      }
      const previous = orderedProfiles;
      setOrderedProfiles(next);
      setIsReordering(true);
      try {
        await saveProfiles(next);
      } catch (error) {
        setOrderedProfiles(previous);
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsReordering(false);
      }
    },
    [isReordering, orderedProfiles, saveProfiles, t],
  );

  const reorderByOffset = useCallback(
    (id: string, offset: -1 | 1) => {
      const index = orderedProfiles.findIndex((entry) => entry.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= orderedProfiles.length) {
        return;
      }
      const next = [...orderedProfiles];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      void persistOrder(next);
    },
    [orderedProfiles, persistOrder],
  );

  const handleMoveUp = useCallback((id: string) => reorderByOffset(id, -1), [reorderByOffset]);
  const handleMoveDown = useCallback((id: string) => reorderByOffset(id, 1), [reorderByOffset]);
  const handleDragEnd = useCallback(
    (next: AgentProfile[]) => void persistOrder(next),
    [persistOrder],
  );

  const removeProfile = useCallback(
    async (id: string) => {
      const profile = orderedProfiles.find((entry) => entry.id === id);
      if (!profile) {
        return;
      }
      const confirmed = await confirmDialog({
        title: t("settings.host.agentProfiles.removeConfirmTitle"),
        message: t("settings.host.agentProfiles.removeConfirmMessage", {
          name: resolveAgentProfileDisplayName({ profile, entries }),
        }),
        confirmLabel: t("settings.host.agentProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        const next = orderedProfiles.filter((entry) => entry.id !== id);
        await saveProfiles(next);
        setOrderedProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [entries, orderedProfiles, saveProfiles, t],
  );
  const handleRemove = useCallback((id: string) => void removeProfile(id), [removeProfile]);

  const renderProfile = useCallback(
    ({ item, index, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<AgentProfile>) => (
      <AgentProfileRow
        profile={item}
        entries={entries}
        isFirst={index === 0}
        isLast={index === orderedProfiles.length - 1}
        isDragging={isActive}
        reorderDisabled={isReordering}
        drag={drag}
        dragHandleProps={dragHandleProps}
        onEdit={handleEditOpen}
        onRemove={handleRemove}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
      />
    ),
    [
      entries,
      handleEditOpen,
      handleMoveDown,
      handleMoveUp,
      handleRemove,
      isReordering,
      orderedProfiles.length,
    ],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addIcon}
        onPress={handleAddOpen}
        disabled={!profiles || isReordering}
        accessibilityLabel={t("settings.host.agentProfiles.addProfileTitle")}
        testID="agent-profiles-add-button"
      />
    ),
    [handleAddOpen, isReordering, profiles, t],
  );

  if (!isConnected || !isSupported) {
    return (
      <SettingsSection
        title={t("settings.host.agentProfiles.sectionTitle")}
        testID="agent-profiles-section"
      >
        <View style={settingsStyles.card} testID="agent-profiles-unavailable">
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {isConnected
                ? t("settings.host.agentProfiles.unsupported")
                : t("settings.host.agentProfiles.unavailable")}
            </Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.agentProfiles.sectionTitle")}
        trailing={addButton}
        testID="agent-profiles-section"
      >
        <View style={settingsStyles.card} testID="agent-profiles-card">
          {orderedProfiles.length > 0 ? (
            <DraggableList
              data={orderedProfiles}
              keyExtractor={profileKey}
              renderItem={renderProfile}
              onDragEnd={handleDragEnd}
              scrollEnabled={false}
              useDragHandle
              nestable={isNative}
              extraData={isReordering}
              testID="agent-profiles-sortable-list"
            />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText} testID="agent-profiles-empty">
                {t("settings.host.agentProfiles.emptyState")}
              </Text>
              <Button size="sm" leftIcon={addIcon} onPress={handleAddOpen} disabled={!profiles}>
                {t("settings.host.agentProfiles.newProfile")}
              </Button>
            </View>
          )}
        </View>
      </SettingsSection>

      <AgentProfileEditModal
        serverId={serverId}
        visible={editTarget !== null}
        mode={editTarget?.mode ?? "create"}
        {...(editTarget?.profile ? { profile: editTarget.profile } : {})}
        onClose={handleEditClose}
        onSave={handleSave}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
