import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { parseSendDelayMinutes } from "./scheduled-send-model";

const HEADER = { title: "定时发送" };
export function ScheduledSendDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (minutes: number) => Promise<void>;
}) {
  const isCompact = useIsCompactFormFactor();
  const [value, setValue] = useState("5");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = parseSendDelayMinutes(value);
  const confirm = useCallback(() => {
    if (minutes === null || pending) return;
    setPending(true);
    setError(null);
    void onConfirm(minutes)
      .then(onClose)
      .catch((cause) => {
        console.error("[Composer] Schedule message failed", cause);
        setError(cause instanceof Error ? cause.message : "定时发送失败，请重试");
      })
      .finally(() => setPending(false));
  }, [minutes, onConfirm, onClose, pending]);
  const close = useCallback(() => {
    if (!pending) onClose();
  }, [onClose, pending]);
  const change = useCallback((text: string) => {
    setValue(text);
    setError(null);
  }, []);
  const footer = useMemo(
    () => (
      <>
        <Button variant="ghost" size="sm" onPress={close} disabled={pending}>
          取消
        </Button>
        <Button
          size="sm"
          onPress={confirm}
          disabled={minutes === null}
          loading={pending}
          testID="scheduled-send-confirm"
        >
          定时发送
        </Button>
      </>
    ),
    [close, confirm, minutes, pending],
  );
  return (
    <AdaptiveModalSheet
      header={HEADER}
      visible
      onClose={close}
      footer={footer}
      desktopMaxWidth={360}
      snapPoints={["45%"]}
      contentContainerStyle={isCompact ? styles.compactContent : undefined}
      testID="scheduled-send-dialog"
    >
      <Field
        label="多少分钟后发送"
        error={value.trim() && minutes === null ? "请输入 1–10080 的整数分钟" : undefined}
      >
        <FormTextInput
          value={value}
          initialValue="5"
          onChangeText={change}
          keyboardType="number-pad"
          size={isCompact ? "md" : "sm"}
          editable={!pending}
          autoFocus
          accessibilityLabel="多少分钟后发送"
          testID="scheduled-send-minutes"
        />
      </Field>
      <Text style={styles.hint}>到时若智能体仍在运行，将等待当前回合结束。</Text>
      {error ? (
        <View>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  compactContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    gap: theme.spacing[3],
  },
  hint: { fontSize: theme.fontSize.xs, color: theme.colors.foregroundMuted },
  error: { fontSize: theme.fontSize.xs, color: theme.colors.statusDanger },
}));
