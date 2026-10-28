import React, { type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
export interface TwoAxisScrollViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  horizontalContentContainerStyle?: StyleProp<ViewStyle>;
}

export function TwoAxisScrollView({
  children,
  style,
  contentContainerStyle,
  horizontalContentContainerStyle,
}: TwoAxisScrollViewProps) {
  return (
    <ScrollView style={style} contentContainerStyle={contentContainerStyle} nestedScrollEnabled>
      <ScrollView
        horizontal
        nestedScrollEnabled
        contentContainerStyle={horizontalContentContainerStyle}
      >
        {children}
      </ScrollView>
    </ScrollView>
  );
}
