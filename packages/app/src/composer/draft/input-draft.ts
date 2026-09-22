import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  buildDraftAgentControls,
  hasDraftContent,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady } from "@/stores/draft-store/state";
import { useCodexProviderInjections } from "@/codex-provider-injections/use-codex-provider-injections";
import { resolveDraftCodexProviderInjection } from "@/codex-provider-injections/draft-selection";

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  isVisible?: boolean;
  onlineServerIds?: string[];
  lockedWorkingDir?: string;
  initialCodexProviderInjectionId?: string | null;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  codexProviderInjectionId: string | null;
  agentControls: DraftAgentControlsProps;
  commandDraftConfig: DraftCommandConfig | undefined;
};

export interface AgentInputDraft {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

interface DraftCodexProviderInjectionState {
  serverId: string | null;
  injectionId: string | null;
  model: string | null;
}

function useDraftCodexProviderInjection(input: {
  composerOptions: AgentInputDraftComposerOptions | null;
  draftKey: string;
  formState: UseAgentFormStateResult;
}) {
  const { composerOptions, draftKey, formState } = input;
  const { injections, isSupported } = useCodexProviderInjections(formState.selectedServerId);
  const [selection, setSelection] = useState<DraftCodexProviderInjectionState>(() => ({
    serverId: composerOptions?.initialServerId ?? null,
    injectionId: composerOptions?.initialCodexProviderInjectionId ?? null,
    model: composerOptions?.initialValues?.model?.trim() || null,
  }));

  useEffect(() => {
    setSelection({
      serverId: formState.selectedServerId,
      injectionId: composerOptions?.initialCodexProviderInjectionId ?? null,
      model: composerOptions?.initialValues?.model?.trim() || null,
    });
  }, [
    composerOptions?.initialCodexProviderInjectionId,
    composerOptions?.initialValues?.model,
    draftKey,
    formState.selectedServerId,
  ]);

  const selectedInjectionId = useMemo(() => {
    if (!isSupported || formState.selectedProvider !== "codex") return null;
    if (selection.serverId !== formState.selectedServerId || !selection.injectionId) return null;
    if (!injections) return null;
    return injections.some((injection) => injection.id === selection.injectionId)
      ? selection.injectionId
      : null;
  }, [formState.selectedProvider, formState.selectedServerId, injections, isSupported, selection]);

  const clearSelection = useCallback(() => {
    setSelection((current) => {
      if (current.injectionId === null) return current;
      return {
        serverId: formState.selectedServerId,
        injectionId: null,
        model: null,
      };
    });
  }, [formState.selectedServerId]);

  useEffect(() => {
    if (!selectedInjectionId || !selection.model || formState.selectedModel === selection.model) {
      return;
    }
    formState.setModelLocally(selection.model);
  }, [formState, selectedInjectionId, selection.model]);

  const selectInjection = useCallback(
    (injectionId: string, model?: string) => {
      if (formState.selectedProvider !== "codex") {
        throw new Error("Codex 服务商注入只能用于 Codex 会话");
      }
      if (!isSupported || !injections) {
        throw new Error("当前守护进程不支持 Codex 服务商注入");
      }
      const resolved = resolveDraftCodexProviderInjection({
        injections,
        injectionId,
        ...(model ? { model } : {}),
      });
      setSelection({
        serverId: formState.selectedServerId,
        injectionId: resolved.injectionId,
        model: resolved.model,
      });
      if (resolved.model) formState.setModelLocally(resolved.model);
    },
    [formState, injections, isSupported],
  );

  const selectProvider = useCallback(
    (provider: Parameters<typeof formState.setProviderFromUser>[0]) => {
      clearSelection();
      formState.setProviderFromUser(provider);
    },
    [clearSelection, formState],
  );
  const selectModel = useCallback(
    (modelId: string) => {
      clearSelection();
      formState.setModelFromUser(modelId);
    },
    [clearSelection, formState],
  );
  const selectProviderAndModel = useCallback(
    (provider: Parameters<typeof formState.setProviderAndModelFromUser>[0], modelId: string) => {
      clearSelection();
      formState.setProviderAndModelFromUser(provider, modelId);
    },
    [clearSelection, formState],
  );

  return useMemo(
    () => ({
      injections: isSupported && injections ? injections : undefined,
      selectedInjectionId,
      selectInjection,
      selectProvider,
      selectModel,
      selectProviderAndModel,
      persistFormPreferences: selectedInjectionId
        ? formState.persistFormPreferencesWithoutModel
        : formState.persistFormPreferences,
    }),
    [
      formState.persistFormPreferences,
      formState.persistFormPreferencesWithoutModel,
      injections,
      isSupported,
      selectInjection,
      selectModel,
      selectProvider,
      selectProviderAndModel,
      selectedInjectionId,
    ],
  );
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const formState = useAgentFormState({
    initialServerId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
    onlineServerIds: composerOptions?.onlineServerIds ?? [],
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const codexProviderInjection = useDraftCodexProviderInjection({
    composerOptions,
    draftKey,
    formState,
  });
  const draftRecord = useDraftStore((state) => state.drafts[draftKey]);
  const draft = useMemo(() => toDraftInputIfReady(draftRecord), [draftRecord]);
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const text = draft?.text ?? "";
  const attachments = draft?.attachments ?? [];
  const isHydrated = hydratedDraftKey === draftKey;

  const saveDraft = useCallback(
    (
      update: (draft: { text: string; attachments: UserComposerAttachment[] }) => {
        text: string;
        attachments: UserComposerAttachment[];
      },
    ) => {
      const store = useDraftStore.getState();
      const current = store.getDraftInput(draftKey) ?? {
        text: "",
        attachments: [],
      };
      const next = update(current);
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  const setText = useCallback(
    (nextText: string) => {
      saveDraft((current) => ({ ...current, text: nextText }));
    },
    [saveDraft],
  );

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
    },
    [draftKey],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  const lockedWorkingDir = composerOptions?.lockedWorkingDir?.trim() ?? "";
  useEffect(() => {
    if (!composerOptions || !lockedWorkingDir) {
      return;
    }
    if (formState.workingDir.trim() === lockedWorkingDir) {
      return;
    }
    formState.setWorkingDir(lockedWorkingDir);
  }, [composerOptions, formState, lockedWorkingDir]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const workingDir = lockedWorkingDir || formState.workingDir;
  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });

  const commandDraftConfig = useMemo(
    () =>
      composerOptions
        ? buildDraftCommandConfig({
            selection: providerSelection,
            cwd: workingDir,
            effectiveModelId,
            effectiveThinkingOptionId,
            featureValues: draftFeatureValues,
          })
        : undefined,
    [
      composerOptions,
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const agentControls = useMemo(
    () => ({
      ...buildDraftAgentControls({
        formState,
        features: draftFeatures,
        onSetFeature: setDraftFeatureValue,
      }),
      onSelectProvider: codexProviderInjection.selectProvider,
      onSelectModel: codexProviderInjection.selectModel,
      onSelectProviderAndModel: codexProviderInjection.selectProviderAndModel,
      codexProviderInjections: codexProviderInjection.injections,
      selectedCodexProviderInjectionId: codexProviderInjection.selectedInjectionId,
      onSelectCodexProviderInjection: codexProviderInjection.selectInjection,
    }),
    [codexProviderInjection, draftFeatures, formState, setDraftFeatureValue],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      persistFormPreferences: codexProviderInjection.persistFormPreferences,
      workingDir,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      codexProviderInjectionId: codexProviderInjection.selectedInjectionId,
      agentControls,
      commandDraftConfig,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    agentControls,
    codexProviderInjection.persistFormPreferences,
    codexProviderInjection.selectedInjectionId,
    draftFeatureValues,
    formState,
    workingDir,
  ]);

  return {
    text,
    setText,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandConfig,
  buildDraftComposerCommandConfig: buildDraftCommandConfig,
  buildDraftAgentControls,
};
