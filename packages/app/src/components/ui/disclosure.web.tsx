import {
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
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
const contentStyle: CSSProperties = { minHeight: 0, display: "flow-root" };
// 收起采用先加速后匀速落位的对称曲线，避免强 ease-out 尾段明显减速拖曳。
const COLLAPSE_EASING_CSS = "cubic-bezier(0.4, 0, 0.6, 1)";

function createDisclosureEffect(params: {
  viewport: HTMLDivElement;
  expanded: boolean;
  animateLayout: boolean;
  fromHeight: number;
  targetHeight: number;
  fromOpacity: string | number;
}): KeyframeEffect {
  const { viewport, expanded, animateLayout, fromHeight, targetHeight, fromOpacity } = params;
  const opacityFrames = [{ opacity: fromOpacity }, { opacity: expanded ? 1 : 0 }];
  const heightFrames = [
    { height: `${fromHeight}px`, ...opacityFrames[0] },
    { height: `${targetHeight}px`, ...opacityFrames[1] },
  ];
  return new KeyframeEffect(viewport, animateLayout ? heightFrames : opacityFrames, {
    duration: expanded ? MOTION_DURATION.base : MOTION_DURATION.fast,
    easing: expanded ? MOTION_EASING_CSS.standard : COLLAPSE_EASING_CSS,
    // 收起保留终帧，避免 onfinish 触发卸载前最后一帧闪回自然高度。
    fill: expanded ? "none" : "forwards",
  });
}

function observeExpandingContentHeight(params: {
  viewport: HTMLDivElement;
  node: HTMLDivElement;
  effect: KeyframeEffect;
  initialHeight: number;
}): ResizeObserver {
  let measuredHeight = params.initialHeight;
  const observer = new ResizeObserver(() => {
    const nextHeight = params.node.getBoundingClientRect().height;
    if (nextHeight === measuredHeight) return;
    measuredHeight = nextHeight;
    const progress = params.effect.getComputedTiming().progress ?? 0;
    if (progress >= 1) return;
    // 保留当前画面与原截止时间，只修改剩余轨迹，不能 finish() 跳到新高度或反复重启动画。
    params.effect.setKeyframes([
      {
        height: `${params.viewport.getBoundingClientRect().height}px`,
        opacity: getComputedStyle(params.viewport).opacity,
        offset: progress,
      },
      { height: `${nextHeight}px`, opacity: 1, offset: 1 },
    ]);
  });
  observer.observe(params.node);
  return observer;
}

// 只为主动开合创建动画；静止时使用自然高度，子命令和流式输出不能触发父层追赶动画。
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousExpanded = useRef(expanded);
  const animationRef = useRef<Animation | null>(null);
  const resizeRef = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const node = contentRef.current;
    if (!viewport || !node) return;
    const wasExpanded = previousExpanded.current;
    previousExpanded.current = expanded;
    const running = animationRef.current;
    const bodyHeight = node.getBoundingClientRect().height;
    const restingHeight = wasExpanded ? bodyHeight : 0;
    const restingOpacity = wasExpanded ? 1 : 0;
    const fromHeight = running ? viewport.getBoundingClientRect().height : restingHeight;
    const fromOpacity = running ? getComputedStyle(viewport).opacity : restingOpacity;
    running?.cancel();
    resizeRef.current?.disconnect();
    animationRef.current = null;
    resizeRef.current = null;
    viewport.removeAttribute("data-disclosure-animating");
    if (reducedMotion || !active) {
      setRetained(expanded);
      return;
    }
    if (wasExpanded === expanded) return;
    if (expanded) setRetained(true);
    if (!expanded && animateLayout && fromHeight <= 0) {
      setRetained(false);
      return;
    }
    const effect = createDisclosureEffect({
      viewport,
      expanded,
      animateLayout,
      fromHeight,
      targetHeight: expanded ? bodyHeight : 0,
      fromOpacity,
    });
    const animation = new Animation(effect, document.timeline);
    viewport.setAttribute("data-disclosure-animating", "");
    animation.play();
    animationRef.current = animation;
    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      resizeRef.current?.disconnect();
      resizeRef.current = null;
      viewport.removeAttribute("data-disclosure-animating");
      if (!expanded) {
        setRetained(false);
        animation.cancel();
      }
    };
    if (!expanded || !animateLayout) return;
    resizeRef.current = observeExpandingContentHeight({
      viewport,
      node,
      effect,
      initialHeight: bodyHeight,
    });
  }, [active, animateLayout, expanded, reducedMotion]);
  useLayoutEffect(
    () => () => {
      animationRef.current?.cancel();
      resizeRef.current?.disconnect();
      viewportRef.current?.removeAttribute("data-disclosure-animating");
    },
    [],
  );
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      position: "relative",
      height: animateLayout && !expanded ? 0 : undefined,
      opacity: expanded ? 1 : 0,
      overflow: "hidden",
      contain: "layout style",
    }),
    [animateLayout, expanded],
  );
  return (
    <div
      data-testid={testID}
      aria-hidden={!expanded}
      inert={!expanded}
      ref={viewportRef}
      style={viewportStyle}
    >
      <div ref={contentRef} style={contentStyle}>
        {content}
      </div>
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
  const easing = expanded ? MOTION_EASING_CSS.standard : COLLAPSE_EASING_CSS;
  const chevronStyle = useMemo<CSSProperties>(
    () => ({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `rotate(${expanded ? expandedRotation : collapsedRotation}deg)`,
      transition: reducedMotion ? "none" : `transform ${duration}ms ${easing}`,
    }),
    [collapsedRotation, duration, easing, expanded, expandedRotation, reducedMotion],
  );
  return (
    <View style={style}>
      <div style={chevronStyle}>{children}</div>
    </View>
  );
}
