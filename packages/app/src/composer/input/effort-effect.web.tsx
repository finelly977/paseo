import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useReducedMotion } from "react-native-reanimated";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { EffortEffectProps } from "./effort-effect.types";
import type { Theme } from "@/styles/theme";

interface Spark {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
}

const canvasStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};
function EffortCanvas({ active, focused, value, color }: EffortEffectProps & { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const energy = useRef(0);
  const previousValue = useRef(value);
  const retained = useRetainedPanelActive() && focused;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (value !== previousValue.current && active)
      energy.current = Math.min(1.6, energy.current + 0.22);
    previousValue.current = value;
  }, [active, value]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !active || !retained || reducedMotion) return;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建最高思考强度的粒子画布");
    const element = canvas;
    const painter = context;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    const sparks: Spark[] = Array.from({ length: 26 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.9 + Math.random(),
      phase: Math.random() * Math.PI * 2,
      speed: 5 + Math.random() * 9,
    }));
    function resize() {
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio);
      width = rect.width;
      height = rect.height;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      painter.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - last < 32) return;
      const delta = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      energy.current *= Math.exp(-delta / 0.8);
      painter.clearRect(0, 0, width, height);
      painter.fillStyle = color;
      painter.shadowColor = color;
      painter.shadowBlur = 6 + energy.current * 10;
      for (const spark of sparks) {
        spark.y -= (spark.speed * delta * (1 + energy.current * 6)) / Math.max(1, height);
        if (spark.y < 0) spark.y = 1;
        const edge = Math.min(1, spark.y * 8, (1 - spark.y) * 8);
        painter.globalAlpha = edge * (0.26 + 0.22 * Math.sin(now / 900 + spark.phase));
        painter.beginPath();
        painter.arc(
          spark.x * width + Math.sin(now / 900 + spark.phase) * 5,
          spark.y * height,
          spark.size * (1 + energy.current * 0.35),
          0,
          Math.PI * 2,
        );
        painter.fill();
      }
    }
    function visibility() {
      cancelAnimationFrame(frame);
      last = 0;
      if (!document.hidden) frame = requestAnimationFrame(tick);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      context.clearRect(0, 0, width, height);
    };
  }, [active, color, reducedMotion, retained]);
  const washStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      borderRadius: "inherit",
      overflow: "hidden",
      background: `radial-gradient(140% 120% at 0% 100%, ${color}26, transparent 62%)`,
    }),
    [color],
  );
  if (!active) return null;
  return (
    <div aria-hidden style={washStyle}>
      {!reducedMotion && retained ? (
        <canvas ref={ref} data-testid="composer-max-effort-particles" style={canvasStyle} />
      ) : null}
    </div>
  );
}

export const EffortEffect = withUnistyles(EffortCanvas, (theme: Theme) => ({
  color: theme.colors.palette.purple[300],
}));
