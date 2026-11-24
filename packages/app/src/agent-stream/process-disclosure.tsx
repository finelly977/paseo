import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { DisclosureContent } from "@/components/ui/disclosure";
import { isWeb } from "@/constants/platform";
const CONTENT_ROW_STYLE = { width: "100%" as const, alignItems: "center" as const };

interface ProcessDisclosureProps {
  turnId?: string;
  expanded: boolean;
  transitioning: boolean;
  estimatedHeight: number;
  children(): ReactNode;
}

export function ProcessDisclosure(props: ProcessDisclosureProps) {
  const dataSet = useMemo(
    () => (props.turnId ? { processTurnId: props.turnId } : undefined),
    [props.turnId],
  );
  if (isWeb) {
    if (!props.expanded) return null;
    // 外层虚拟器始终测量自然行高；不观察或缓存动画中间高度。
    return (
      <View style={CONTENT_ROW_STYLE} testID="process-disclosure" dataSet={dataSet}>
        {props.children()}
      </View>
    );
  }
  return <NativeProcessDisclosure {...props} />;
}

function NativeProcessDisclosure({
  expanded,
  transitioning,
  estimatedHeight,
  children,
}: ProcessDisclosureProps) {
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
    <DisclosureContent
      expanded={expanded && ready}
      animateLayout={false}
      testID="process-disclosure"
    >
      {() => <View style={CONTENT_ROW_STYLE}>{children()}</View>}
    </DisclosureContent>
  );
}
