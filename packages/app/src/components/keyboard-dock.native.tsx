import type { ReactNode } from "react";
import type { ViewProps } from "react-native";
import { Platform, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useKeyboardShift } from "@/hooks/use-keyboard-shift-style";
import { useRetainedPanelActive } from "@/components/retained-panel";

const FILL_STYLE = { flex: 1 } as const;

interface KeyboardDockProps extends ViewProps {
  children: ReactNode;
}

export function KeyboardDock({ children, style, ...props }: KeyboardDockProps) {
  const { shift, settledShift } = useKeyboardShift();
  const isActive = useRetainedPanelActive();
  const isAndroid = Platform.OS === "android";
  const keyboardPaddingStyle = useAnimatedStyle(() => {
    // 安卓动画期间只移动合成层，结束时才改变列表可用高度，避免逐帧重排整段历史。
    let paddingBottom = 0;
    let translateY = 0;
    if (isActive) {
      paddingBottom = isAndroid ? settledShift.value : shift.value;
      if (isAndroid) translateY = settledShift.value - shift.value;
    }
    return { paddingBottom, transform: [{ translateY }] };
  });

  return (
    <View style={style} {...props}>
      <Animated.View style={[FILL_STYLE, keyboardPaddingStyle]}>{children}</Animated.View>
    </View>
  );
}
