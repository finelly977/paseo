import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { agentFailurePresentation } from "./agent-failure-presentation";

export function AgentFailure({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "pending" | "copied" | "error">("idle");
  const presentation = useMemo(() => agentFailurePresentation(message), [message]);
  const toggleDetails = useCallback(() => setExpanded((value) => !value), []);
  const copyDetails = useCallback(async () => {
    setCopyStatus("pending");
    try {
      const copied = await Clipboard.setStringAsync(presentation.details);
      if (!copied) throw new Error("Clipboard copy was rejected");
      setCopyStatus("copied");
    } catch (error) {
      console.error("Failed to copy agent diagnostics", error);
      setCopyStatus("error");
    }
  }, [presentation.details]);
  return (
    <Alert
      variant="error"
      title="智能体运行失败"
      description={presentation.summary}
      testID="agent-failure"
    >
      <View style={styles.actions}>
        <Button
          variant="ghost"
          size="xs"
          onPress={toggleDetails}
          testID="agent-failure-details-toggle"
        >
          {expanded ? "收起诊断" : "查看诊断"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onPress={copyDetails}
          loading={copyStatus === "pending"}
          disabled={copyStatus === "pending"}
          testID="agent-failure-copy"
        >
          {copyStatus === "copied" ? "已复制诊断" : "复制诊断"}
        </Button>
      </View>
      {copyStatus === "error" ? (
        <Text style={styles.copyError}>复制失败，请展开诊断后手动复制，或重试。</Text>
      ) : null}
      {expanded ? (
        <ScrollView nestedScrollEnabled style={styles.details} testID="agent-failure-details">
          <Text selectable style={styles.detailsText}>
            {presentation.details}
          </Text>
        </ScrollView>
      ) : null}
    </Alert>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  details: { maxHeight: 240, marginTop: theme.spacing[2] },
  detailsText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  copyError: { color: theme.colors.destructive, fontSize: theme.fontSize.xs },
}));
