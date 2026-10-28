import React from "react";
import { View } from "react-native";
import type { TwoAxisScrollViewProps } from "./two-axis-scroll-view";

const viewportStyle = { overflow: "auto", flex: "1 1 auto", minHeight: 0, minWidth: 0 } as const;
const contentStyle = { minWidth: "100%", width: "max-content" } as const;

/** 两轴共用 DOM 视口，横向滚动条留在可视区域底部。 */
export function TwoAxisScrollView({
  children,
  style,
  contentContainerStyle,
  horizontalContentContainerStyle,
}: TwoAxisScrollViewProps) {
  return (
    <View style={style}>
      <div style={viewportStyle} data-code-scroll-viewport tabIndex={0}>
        <div style={contentStyle}>
          <View style={[contentContainerStyle, horizontalContentContainerStyle]}>{children}</View>
        </div>
      </div>
    </View>
  );
}
