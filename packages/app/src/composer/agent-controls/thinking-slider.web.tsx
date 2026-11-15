import { useCallback, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { MOTION_DURATION, MOTION_EASING_CSS } from "@/styles/motion";
import type { ThinkingSliderProps } from "./thinking-slider.types";
import { useReducedMotion } from "react-native-reanimated";

interface SliderColors {
  track: string;
  fill: string;
  thumb: string;
  dot: string;
  focus: string;
  spark: string;
}

function sliderColors(theme: Theme): SliderColors {
  return {
    track: theme.colors.surface1,
    fill: theme.colors.surface3,
    thumb: theme.colors.foreground,
    dot: theme.colors.foregroundMuted,
    focus: theme.colors.accent,
    spark:
      theme.colorScheme === "dark"
        ? theme.colors.palette.purple[300]
        : theme.colors.palette.purple[600],
  };
}

const trackStyle: CSSProperties = { position: "relative", height: 22, borderRadius: 11 };
const rangeStyle: CSSProperties = {
  position: "absolute",
  inset: "-7px 0",
  width: "100%",
  height: 36,
  margin: 0,
  opacity: 0,
  cursor: "pointer",
  touchAction: "none",
};
const pointAt = (index: number, count: number) =>
  `calc(11px + (100% - 22px) * ${index / Math.max(1, count - 1)})`;

function Slider({
  options,
  selectedIndex,
  disabled,
  maxed,
  onSelect,
  track,
  fill,
  thumb,
  dot,
  focus,
  spark,
}: ThinkingSliderProps & SliderColors) {
  const [focused, setFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onSelect(event.currentTarget.valueAsNumber),
    [onSelect],
  );
  const index = Math.max(0, selectedIndex);
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const surfaceStyle = useMemo<CSSProperties>(
    () => ({
      ...trackStyle,
      background: track,
      outline: focused ? `2px solid ${focus}` : undefined,
      outlineOffset: 3,
      opacity: disabled ? 0.5 : 1,
    }),
    [track, focused, focus, disabled],
  );
  const fillStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      inset: 0,
      width: pointAt(index, options.length),
      borderRadius: 11,
      background: maxed ? `${spark}59` : fill,
    }),
    [index, options.length, maxed, spark, fill],
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
      background: maxed ? spark : thumb,
      transition: reducedMotion
        ? "none"
        : `left ${MOTION_DURATION.base}ms ${MOTION_EASING_CSS.standard}`,
    }),
    [index, options.length, maxed, spark, thumb, reducedMotion],
  );
  return (
    <div style={surfaceStyle}>
      <div aria-hidden style={fillStyle} />
      {options.map((option, i) => (
        <span key={option.id} aria-hidden style={points[i]} />
      ))}
      <span aria-hidden style={thumbStyle} />
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
        style={rangeStyle}
      />
    </div>
  );
}

export const ThinkingSlider = withUnistyles(Slider, sliderColors);
