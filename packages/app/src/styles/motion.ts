/**
 * Motion tokens — 全局动效的时长、缓动与弹簧预设。
 *
 * 取值对齐 Claude Desktop 设计系统（claude-storybook 逆向）：五档时长、
 * 三条标准贝塞尔曲线、四个弹簧预设。这里是纯常量模块：不依赖 theme，也不
 * 引入 react-native-reanimated；消费方按需用 `Easing.bezier(...MOTION_BEZIER.x)`
 * 构造缓动函数，web 侧 CSS 过渡直接使用 `MOTION_EASING_CSS.x` 字符串。
 */
export const MOTION_DURATION = {
  /** 微交互：即时反馈、浮层退出 */
  instant: 60,
  /** 快：菜单与浮层入场、toast 出入 */
  fast: 120,
  /** 基础：开关、悬停过渡、输入框聚焦 */
  base: 200,
  /** 慢：块级入场 */
  slow: 300,
  /** 揭示：消息入场等强调动画 */
  reveal: 450,
} as const;

export const MOTION_BEZIER = {
  /** 平滑减速（近似 easeOutQuart） */
  standard: [0.165, 0.84, 0.44, 1],
  /** 快速启动、果断咬合到位 */
  snap: [0.32, 0.72, 0, 1],
  /** 1.3 倍轻微超调的自然弹性 */
  overshoot: [0.34, 1.3, 0.64, 1],
} as const;

export const MOTION_EASING_CSS = {
  standard: "cubic-bezier(0.165, 0.84, 0.44, 1)",
  snap: "cubic-bezier(0.32, 0.72, 0, 1)",
  overshoot: "cubic-bezier(0.34, 1.3, 0.64, 1)",
} as const;

export const MOTION_SPRING = {
  /** 按压回弹 */
  press: { stiffness: 600, damping: 30 },
  /** 卡片与气泡入场 */
  card: { stiffness: 320, damping: 28 },
  /** 活泼弹入 */
  bouncy: { stiffness: 380, damping: 18 },
  /** 拖拽跟手 */
  drag: { stiffness: 1200, damping: 80, mass: 0.1 },
} as const;

/** 按压反馈缩放：文本按钮与小圆形图标钮两档。 */
export const MOTION_PRESS_SCALE = {
  button: 0.95,
  iconButton: 0.92,
} as const;
