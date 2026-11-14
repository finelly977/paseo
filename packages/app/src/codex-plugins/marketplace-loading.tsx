import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";

const rows = ["first", "second", "third", "fourth"];
const busyState = { busy: true };

/** 动画只改变整体透明度，不参与目录布局测量；减少动态效果时保留静态占位。 */
function LoadingFrame({ label, children }: { label: string; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: isNative,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: isNative,
          isInteraction: false,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      opacity.setValue(1);
    };
  }, [opacity, reducedMotion]);
  const pulse = useMemo(() => ({ opacity }), [opacity]);
  return (
    <View
      style={styles.frame}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={busyState}
      testID="codex-market-loading"
    >
      <Text style={styles.status} accessibilityLiveRegion="polite">
        {label}
      </Text>
      <Animated.View
        style={pulse}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Animated.View>
    </View>
  );
}

function LoadingRow({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.row, compact && styles.compactRow]}>
      <View style={compact ? styles.smallIcon : styles.icon} />
      <View style={styles.lines}>
        <View style={styles.name} />
        {!compact ? (
          <>
            <View style={styles.description} />
            <View style={styles.shortDescription} />
          </>
        ) : null}
      </View>
    </View>
  );
}

export function CatalogLoading({ twoColumns, sources }: { twoColumns: boolean; sources: boolean }) {
  const cardStyle = useMemo(
    () => [styles.card, twoColumns && !sources && styles.cardTwo],
    [twoColumns, sources],
  );
  return (
    <LoadingFrame label={sources ? "正在读取市场来源" : "正在同步插件目录"}>
      <View style={styles.sections}>
        {(sources ? ["sources"] : ["primary", "secondary"]).map((section) => (
          <View key={section} style={styles.section}>
            <View style={styles.sectionTitle} />
            <View style={styles.grid}>
              {rows.map((row) => (
                <View key={row} style={cardStyle}>
                  <LoadingRow />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </LoadingFrame>
  );
}

export function InstalledLoading() {
  return (
    <LoadingFrame label="正在读取已安装插件">
      {rows.map((row) => (
        <LoadingRow key={row} compact />
      ))}
    </LoadingFrame>
  );
}

export function DetailLoading() {
  return (
    <LoadingFrame label="正在读取应用、技能和工具">
      <View style={styles.section}>
        <View style={styles.sectionTitle} />
        <LoadingRow />
        <LoadingRow />
      </View>
    </LoadingFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { gap: theme.spacing[6] },
  status: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  sections: { gap: theme.spacing[8] },
  section: { gap: theme.spacing[3] },
  sectionTitle: {
    width: 96,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "2.5%", rowGap: 10 },
  card: {
    width: "100%",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  cardTwo: { width: "48.75%" },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  compactRow: { minHeight: 40, paddingVertical: theme.spacing[2] },
  icon: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
  },
  smallIcon: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  lines: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
  name: {
    width: "46%",
    height: 14,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  description: {
    width: "94%",
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  shortDescription: {
    width: "68%",
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
}));
