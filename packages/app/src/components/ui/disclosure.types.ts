import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface DisclosureContentProps {
  expanded: boolean;
  children: () => ReactNode;
  testID?: string;
}

export interface DisclosureChevronProps {
  expanded: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  collapsedRotation?: number;
  expandedRotation?: number;
}
