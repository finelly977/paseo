import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface DisclosureContentProps {
  expanded: boolean;
  children: () => ReactNode;
  testID?: string;
  /** 虚拟列表原生过程行一次更新布局，只过渡透明度，避免逐帧重排与滚动校正互相争抢。 */
  animateLayout?: boolean;
}

export interface DisclosureChevronProps {
  expanded: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  collapsedRotation?: number;
  expandedRotation?: number;
}
