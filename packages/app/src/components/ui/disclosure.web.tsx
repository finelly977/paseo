import {
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type TransitionEvent,
} from "react";
import { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { MOTION_DURATION, MOTION_EASING_CSS } from "@/styles/motion";
import type { DisclosureChevronProps, DisclosureContentProps } from "./disclosure.types";

const reducedMotionQuery = () => {
  if (isWeb) return window.matchMedia("(prefers-reduced-motion: reduce)");
  throw new Error("网页披露组件不能在原生端运行");
};
const readReducedMotion = () => reducedMotionQuery().matches;
const readServerReducedMotion = () => false;
const subscribeReducedMotion = (notify: () => void) => {
  const query = reducedMotionQuery();
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const contentStyle: CSSProperties = { minHeight: 0, overflow: "hidden" };

// CSS Grid 自然测量内容，组件不逐帧设置高度或触发 React 渲染。
export function DisclosureContent({
  expanded,
  children,
  testID,
  animateLayout = true,
}: DisclosureContentProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    readServerReducedMotion,
  );
  const active = useRetainedPanelActive();
  const [retained, setRetained] = useState(expanded);
  const hasContent = expanded || retained;
  const content = useMemo(() => (hasContent ? children() : null), [hasContent, children]);
  useLayoutEffect(() => {
    if (expanded || reducedMotion || !active) setRetained(expanded);
  }, [active, expanded, reducedMotion]);
  useEffect(() => {
    if (expanded || !retained || reducedMotion || !active) return;
    // 同一帧内开合时 CSS 可能没有产生过渡事件，也必须释放隐藏正文。
    const timer = setTimeout(
      () => setRetained(false),
      MOTION_DURATION.fast + MOTION_DURATION.instant,
    );
    return () => clearTimeout(timer);
  }, [active, expanded, reducedMotion, retained]);
  const duration = expanded ? MOTION_DURATION.base : MOTION_DURATION.fast;
  const transition = reducedMotion
    ? "none"
    : `grid-template-rows ${duration}ms ${MOTION_EASING_CSS.standard}, opacity ${duration}ms ${MOTION_EASING_CSS.standard}`;
  const opacityTransition = reducedMotion
    ? "none"
    : `opacity ${duration}ms ${MOTION_EASING_CSS.standard}`;
  const finishClosing = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        (event.propertyName === "grid-template-rows" || event.propertyName === "opacity") &&
        !expanded
      )
        setRetained(false);
    },
    [expanded],
  );
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      display: "grid",
      gridTemplateRows: expanded ? "1fr" : "0fr",
      opacity: expanded ? 1 : 0,
      overflow: "hidden",
      transition: animateLayout ? transition : opacityTransition,
    }),
    [animateLayout, expanded, opacityTransition, transition],
  );
  return (
    <div
      data-testid={testID}
      aria-hidden={!expanded}
      inert={!expanded}
      onTransitionEnd={finishClosing}
      style={viewportStyle}
    >
      <div style={contentStyle}>{content}</div>
    </div>
  );
}

export function DisclosureChevron({
  expanded,
  children,
  style,
  collapsedRotation = 0,
  expandedRotation = 90,
}: DisclosureChevronProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    readServerReducedMotion,
  );
  const duration = expanded ? MOTION_DURATION.base : MOTION_DURATION.fast;
  const chevronStyle = useMemo<CSSProperties>(
    () => ({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `rotate(${expanded ? expandedRotation : collapsedRotation}deg)`,
      transition: reducedMotion ? "none" : `transform ${duration}ms ${MOTION_EASING_CSS.standard}`,
    }),
    [collapsedRotation, duration, expanded, expandedRotation, reducedMotion],
  );
  return (
    <View style={style}>
      <div style={chevronStyle}>{children}</div>
    </View>
  );
}
