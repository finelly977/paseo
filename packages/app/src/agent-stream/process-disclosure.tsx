import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { DisclosureContent } from "@/components/ui/disclosure";
const CONTENT_ROW_STYLE = { width: "100%" as const, alignItems: "center" as const };

export function ProcessDisclosure({
  expanded,
  transitioning,
  estimatedHeight,
  children,
}: {
  expanded: boolean;
  transitioning: boolean;
  estimatedHeight: number;
  children(): ReactNode;
}) {
  const [ready, setReady] = useState(!expanded || !transitioning);
  const [mountedExpanded] = useState(expanded);
  const placeholderStyle = useMemo(
    () => ({ height: estimatedHeight, width: "100%" as const }),
    [estimatedHeight],
  );
  useLayoutEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  // 收起期间才进入虚拟窗口的离屏行只保留原来的行高估算，避免零高测量把整段历史追赶挂载。
  if (!expanded && transitioning && !mountedExpanded) {
    return <View style={placeholderStyle} pointerEvents="none" aria-hidden />;
  }
  return (
    <DisclosureContent expanded={expanded && ready} testID="process-disclosure">
      {() => <View style={CONTENT_ROW_STYLE}>{children()}</View>}
    </DisclosureContent>
  );
}
