import { useEffect, useRef, type CSSProperties } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { useRetainedPanelActive } from "@/components/retained-panel";

const canvasStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  borderRadius: "inherit",
};

/** 只在最高档滑轨内闪动，不影响输入框和按钮表面。 */
export function ThinkingSliderParticles() {
  const ref = useRef<HTMLCanvasElement>(null);
  const retained = useRetainedPanelActive();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !retained || reducedMotion) return;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建思考滑轨粒子画布");
    const element = canvas;
    const painter = context;
    let width = 0,
      height = 0,
      frame = 0,
      last = 0;
    const sparks = Array.from({ length: 22 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.6 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
    }));
    function resize() {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const scale = Math.min(2, window.devicePixelRatio);
      element.width = Math.round(width * scale);
      element.height = Math.round(height * scale);
      painter.setTransform(scale, 0, 0, scale, 0, 0);
    }
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - last < 32) return;
      const delta = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      painter.clearRect(0, 0, width, height);
      painter.fillStyle = "#ffffff";
      for (const spark of sparks) {
        spark.x = (spark.x + delta * 0.035) % 1;
        painter.globalAlpha = 0.35 + Math.sin(now / 800 + spark.phase) * 0.3;
        painter.beginPath();
        painter.arc(
          spark.x * width,
          3 + spark.y * Math.max(0, height - 6),
          spark.size,
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
    };
  }, [retained, reducedMotion]);
  if (!retained || reducedMotion) return null;
  return (
    <canvas ref={ref} data-testid="thinking-slider-particles" aria-hidden style={canvasStyle} />
  );
}
