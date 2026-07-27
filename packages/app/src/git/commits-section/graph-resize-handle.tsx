import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

interface GraphResizeHandleProps {
  gesture: GestureType;
}

const HIGHLIGHT_DELAY_MS = 100;
const webCursorStyle = isWeb ? ({ cursor: "row-resize" } as object) : null;

export function GraphResizeHandle({ gesture }: GraphResizeHandleProps) {
  const [highlighted, setHighlighted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const handleHoverIn = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHighlighted(true);
    }, HIGHLIGHT_DELAY_MS);
  }, [clearTimer]);

  const handleHoverOut = useCallback(() => {
    clearTimer();
    setHighlighted(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="调整 Git 图表高度"
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={[styles.hitArea, webCursorStyle]}
        testID="git-graph-resize-handle"
      >
        {highlighted ? <View pointerEvents="none" style={styles.highlight} /> : null}
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  hitArea: {
    position: "absolute",
    top: -5,
    left: 0,
    right: 0,
    height: 10,
    zIndex: 10,
  },
  highlight: {
    position: "absolute",
    top: 5,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.colors.foreground,
    opacity: 0.25,
  },
}));
