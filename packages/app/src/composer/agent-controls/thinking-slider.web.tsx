import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type CSSProperties,
} from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { MOTION_DURATION, MOTION_EASING_CSS } from "@/styles/motion";
import type { ThinkingSliderProps } from "./thinking-slider.types";
import { useReducedMotion } from "react-native-reanimated";
import { ThinkingSliderParticles } from "./thinking-slider-particles.web";

interface SliderColors {
  blue: string;
  dot: string;
  focus: string;
  spark: string;
}

function sliderColors(theme: Theme): SliderColors {
  return {
    blue: theme.colors.palette.blue[600],
    dot: theme.colors.foregroundMuted,
    focus: theme.colors.accent,
    spark:
      theme.colorScheme === "dark"
        ? theme.colors.palette.purple[300]
        : theme.colors.palette.purple[600],
  };
}

const trackStyle: CSSProperties = { position: "relative", height: 22, borderRadius: 11 };
const sliderStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  minWidth: 0,
  height: 28,
  paddingBlock: 3,
  boxSizing: "border-box",
};
const paintStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "inherit",
  overflow: "hidden",
  pointerEvents: "none",
};
const rangeStyle: CSSProperties = {
  position: "absolute",
  inset: "-7px 0",
  width: "100%",
  height: 36,
  margin: 0,
  opacity: 0,
  cursor: "pointer",
  touchAction: "none",
  outline: "none",
};
const pointAt = (index: number, count: number) =>
  `calc(11px + (100% - 22px) * ${index / Math.max(1, count - 1)})`;

export function ThinkingSliderView({
  options,
  selectedIndex,
  disabled,
  maxed,
  onSelect,
  blue,
  dot,
  focus,
  spark,
}: ThinkingSliderProps & SliderColors) {
  const [focused, setFocused] = useState(false);
  const pointerFocus = useRef(false);
  const reducedMotion = useReducedMotion();
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onSelect(event.currentTarget.valueAsNumber),
    [onSelect],
  );
  const index = Math.max(0, selectedIndex);
  const handleFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) =>
      setFocused(!pointerFocus.current && event.currentTarget.matches(":focus-visible")),
    [],
  );
  const handleBlur = useCallback(() => {
    pointerFocus.current = false;
    setFocused(false);
  }, []);
  const handlePointerDown = useCallback(() => {
    pointerFocus.current = true;
    setFocused(false);
  }, []);
  const handleKeyDown = useCallback(() => {
    pointerFocus.current = false;
    setFocused(true);
  }, []);
  const surfaceStyle = useMemo<CSSProperties>(
    () => ({
      ...trackStyle,
      background: `${spark}33`,
      outline: "none",
      outlineOffset: 3,
      opacity: disabled ? 0.5 : 1,
    }),
    [spark, disabled],
  );
  const fillStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      inset: 0,
      width: maxed ? "100%" : pointAt(index, options.length),
      borderRadius: 11,
      background: maxed ? `linear-gradient(100deg, ${blue}, ${spark} 55%, ${blue})` : `${spark}77`,
    }),
    [index, options.length, maxed, spark, blue],
  );
  const points = useMemo(
    () =>
      options.map(
        (_option, i): CSSProperties => ({
          position: "absolute",
          left: pointAt(i, options.length),
          top: 9,
          width: 4,
          height: 4,
          marginLeft: -2,
          borderRadius: 2,
          background: dot,
        }),
      ),
    [options, dot],
  );
  const thumbStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      top: -3,
      left: pointAt(index, options.length),
      width: 14,
      height: 28,
      marginLeft: -7,
      borderRadius: 7,
      background: spark,
      outline: focused ? `1px solid ${focus}` : "none",
      outlineOffset: 2,
      transition: reducedMotion
        ? "none"
        : `left ${MOTION_DURATION.base}ms ${MOTION_EASING_CSS.standard}`,
    }),
    [index, options.length, spark, reducedMotion, focus, focused],
  );
  return (
    <div style={sliderStyle} data-testid="thinking-slider">
      <div style={surfaceStyle} data-testid="thinking-slider-track">
        <div aria-hidden style={paintStyle} data-testid="thinking-slider-paint">
          <div style={fillStyle} />
          {maxed ? <ThinkingSliderParticles /> : null}
          {!maxed ? options.map((option, i) => <span key={option.id} style={points[i]} />) : null}
        </div>
        <span aria-hidden style={thumbStyle} data-testid="thinking-slider-thumb" />
        <input
          type="range"
          min={0}
          max={Math.max(0, options.length - 1)}
          step={1}
          value={index}
          disabled={disabled || options.length < 2}
          aria-label="思考强度"
          aria-valuetext={options[index]?.label ?? ""}
          onChange={change}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          style={rangeStyle}
        />
      </div>
    </div>
  );
}

export const ThinkingSlider = withUnistyles(ThinkingSliderView, sliderColors);
