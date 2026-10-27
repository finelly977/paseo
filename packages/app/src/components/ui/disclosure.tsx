import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { MOTION_BEZIER, MOTION_DURATION } from "@/styles/motion";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { DisclosureChevronProps, DisclosureContentProps } from "./disclosure.types";

const easing = Easing.bezier(...MOTION_BEZIER.standard);

/** 只过渡显式展开操作；初次挂载、流式更新与内容重测不播放入场动画。 */
export function DisclosureContent({ expanded, children, testID }: DisclosureContentProps) {
  const reducedMotion = useReducedMotion();
  const active = useRetainedPanelActive();
  const [retained, setRetained] = useState(expanded);
  const hasContent = expanded || retained;
  const content = useMemo(() => (hasContent ? children() : null), [hasContent, children]);
  const [initiallyExpanded] = useState(expanded);
  const previousExpanded = useRef(expanded);
  const awaitingOpenMeasurement = useRef(false);
  const measured = useSharedValue(false);
  const contentHeight = useSharedValue(0);
  const height = useSharedValue(0);
  const progress = useSharedValue(expanded ? 1 : 0);
  const finishClosing = useCallback(() => {
    // 收起完成的回调可能排在再次展开之后，不能卸载刚展开的内容。
    if (previousExpanded.current) return;
    contentHeight.value = 0;
    setRetained(false);
  }, [contentHeight]);

  useLayoutEffect(() => {
    if (previousExpanded.current === expanded && !reducedMotion && active) return;
    previousExpanded.current = expanded;
    cancelAnimation(height);
    cancelAnimation(progress);

    if (expanded) {
      setRetained(true);
      awaitingOpenMeasurement.current = contentHeight.value === 0;
    }
    if (reducedMotion || !active) {
      height.value = expanded ? contentHeight.value : 0;
      progress.value = expanded ? 1 : 0;
      setRetained(expanded);
      return;
    }

    const duration = expanded ? MOTION_DURATION.base : MOTION_DURATION.fast;
    progress.value = withTiming(expanded ? 1 : 0, { duration, easing });
    height.value = withTiming(
      expanded ? contentHeight.value : 0,
      { duration, easing },
      (finished) => {
        if (finished && !expanded) {
          scheduleOnRN(finishClosing);
        }
      },
    );
    return () => {
      cancelAnimation(height);
      cancelAnimation(progress);
    };
  }, [active, contentHeight, expanded, finishClosing, height, progress, reducedMotion]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height: nextHeight } = event.nativeEvent.layout;
      // 隐藏面板的零宽不是有效测量；有宽度的空正文允许收缩到零。
      if (!active || width <= 0 || nextHeight === contentHeight.value) return;
      contentHeight.value = nextHeight;
      measured.value = true;
      if (!expanded) return;
      if (awaitingOpenMeasurement.current && !reducedMotion) {
        height.value = withTiming(nextHeight, { duration: MOTION_DURATION.base, easing });
      } else {
        height.value = nextHeight;
      }
      awaitingOpenMeasurement.current = false;
    },
    [active, contentHeight, expanded, height, measured, reducedMotion],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    height: measured.value || !initiallyExpanded ? height.value : undefined,
    opacity: progress.value,
  }));

  if (!expanded && !retained) return null;
  return (
    <Animated.View
      testID={testID}
      style={[styles.viewport, animatedStyle]}
      pointerEvents={expanded ? "auto" : "none"}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      aria-hidden={!expanded}
    >
      <View style={styles.content} onLayout={onLayout}>
        {content}
      </View>
    </Animated.View>
  );
}

export function DisclosureChevron({
  expanded,
  children,
  style,
  collapsedRotation = 0,
  expandedRotation = 90,
}: DisclosureChevronProps) {
  const rotation = useSharedValue(expanded ? expandedRotation : collapsedRotation);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const target = expanded ? expandedRotation : collapsedRotation;
    rotation.value = reducedMotion
      ? target
      : withTiming(target, {
          duration: expanded ? MOTION_DURATION.base : MOTION_DURATION.fast,
          easing,
        });
    return () => cancelAnimation(rotation);
  }, [collapsedRotation, expanded, expandedRotation, reducedMotion, rotation]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <View style={style}>
      <Animated.View style={[styles.chevron, animatedStyle]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { overflow: "hidden", flexShrink: 0 },
  content: { flexShrink: 0 },
  chevron: { alignItems: "center", justifyContent: "center" },
});
