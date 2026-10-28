import React, { useMemo, type ReactNode } from "react";
import { View } from "react-native";

export function AssistantMessageBlockContainer({
  marginBottom,
  children,
}: {
  block: string;
  marginBottom: number;
  children: ReactNode;
}) {
  const style = useMemo(() => (marginBottom > 0 ? { marginBottom } : undefined), [marginBottom]);
  return <View style={style}>{children}</View>;
}
