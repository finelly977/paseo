/**
 * 按稳定节奏显示流式助手文字。
 *
 * 守护进程每 60 毫秒合并一次增量，每批字符数取决于模型当时的输出速度。若增量一到就
 * 直接绘制，用户会看到大小不一的文字块跳出。这里让增量只更新目标文本，再根据积压量
 * 计算显示速度：突发内容会更快追上，但不会整块跳变。
 *
 * 仓库仍保存完整文本，只有渲染切片受节奏控制，因此复制、选择、对话索引和滚动几何都
 * 与屏幕实际内容一致。
 *
 * 本模块保持为纯函数；React Hook 只提供帧时钟，策略无需渲染器即可测试。
 */

// 在这个时间范围内消化积压。过短会接近原始批次节奏，过长会在回合尾部产生可感知延迟。
export const TEXT_REVEAL_HORIZON_MS = 150;

/** 即使屏幕刷新率更高，也最多按 60Hz 提交一次显示进度。 */
export const TEXT_REVEAL_FRAME_INTERVAL_MS = 1000 / 60;

// 限制单帧使用的时间跨度，避免后台标签页或主线程阻塞后用一个巨大时间差造成突跳。
const MAX_ELAPSED_MS = 250;

/**
 * 计算本帧显示的字符数。速度与积压量成比例，模型领先越多追赶越快；至少前进一步，
 * 保证尾部最终能够完成。
 */
export function computeRevealStep(input: {
  backlog: number;
  elapsedMs: number;
  horizonMs?: number;
}): number {
  const { backlog } = input;
  if (backlog <= 0) {
    return 0;
  }

  const horizonMs = input.horizonMs ?? TEXT_REVEAL_HORIZON_MS;
  if (horizonMs <= 0) {
    return backlog;
  }

  const elapsedMs = Math.min(Math.max(input.elapsedMs, 0), MAX_ELAPSED_MS);
  if (elapsedMs <= 0) {
    return 0;
  }
  if (elapsedMs >= horizonMs) {
    return backlog;
  }

  const step = Math.ceil((backlog * elapsedMs) / horizonMs);
  return Math.min(backlog, Math.max(1, step));
}

const ZERO_WIDTH_JOINER = 0x200d;

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** 节奏显示依赖符合规范的字素分段器；旧运行时直接显示整批内容，避免短暂破坏字形。 */
export function isTextRevealPacingSupported(): boolean {
  return graphemeSegmenter !== null;
}

/**
 * 把切分位置回退到安全边界。直接在任意索引调用 `slice` 可能拆开字素簇，让一个可见字形
 * 在流式输出期间短暂显示为多个部分。这里只移动渲染边界，进度计数仍单调增加，因此较长
 * 字素簇不会让显示停住，下一帧会越过它。
 */
export function clampToSafeRevealBoundary(text: string, index: number): number {
  if (index <= 0) {
    return 0;
  }
  if (index >= text.length) {
    return text.length;
  }

  const segment = graphemeSegmenter?.segment(text).containing(index);
  return segment?.index ?? 0;
}

export interface TextRevealFrame {
  elapsedMs: number;
  frameAtMs: number;
}

/** 结转不足一帧的时间余量，把提交频率固定在 60Hz，不随高刷新率屏幕加速。 */
export function nextTextRevealFrame(
  previousFrameAtMs: number | null,
  timestampMs: number,
): TextRevealFrame | null {
  const elapsedMs =
    previousFrameAtMs === null ? TEXT_REVEAL_FRAME_INTERVAL_MS : timestampMs - previousFrameAtMs;
  if (elapsedMs < TEXT_REVEAL_FRAME_INTERVAL_MS) {
    return null;
  }
  return {
    elapsedMs,
    frameAtMs: timestampMs - (elapsedMs % TEXT_REVEAL_FRAME_INTERVAL_MS),
  };
}

export interface TextRevealState {
  /** 仓库已知的完整文本。 */
  readonly target: string;
  /** 已显示的长度；在同一条消息内单调增加。 */
  readonly revealed: number;
}

/**
 * 第一次看到某段文本时完整显示，只对后续增长做节奏控制。这样历史恢复、时间线重放、
 * 虚拟列表重挂载和已完成消息都能在首次绘制时直接完整出现，无需分别增加特殊分支。
 */
export function beginTextReveal(text: string): TextRevealState {
  return { target: text, revealed: text.length };
}

/** 更新目标文本，但不改变当前显示进度。 */
export function retargetTextReveal(state: TextRevealState, text: string): TextRevealState {
  if (state.target === text) {
    return state;
  }
  // 文本缩短说明这个位置已经在显示另一条消息，原显示进度不再完全适用。
  return { target: text, revealed: Math.min(state.revealed, text.length) };
}

/** 推进一帧应显示的字符。 */
export function advanceTextReveal(
  state: TextRevealState,
  elapsedMs: number,
  horizonMs?: number,
): TextRevealState {
  const step = computeRevealStep({
    backlog: state.target.length - state.revealed,
    elapsedMs,
    ...(horizonMs !== undefined ? { horizonMs } : {}),
  });
  if (step <= 0) {
    return state;
  }
  return { target: state.target, revealed: Math.min(state.target.length, state.revealed + step) };
}

/** 回合结束时立即显示全部内容，不再保留尾部。 */
export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (state.revealed >= state.target.length) {
    return state;
  }
  return { target: state.target, revealed: state.target.length };
}

export function isTextRevealSettled(state: TextRevealState): boolean {
  return state.revealed >= state.target.length;
}

/**
 * 暂不显示无法独立成立的尾部片段。字素簇不仅可能在渲染边界被切开，守护进程的合并窗口
 * 也可能在任意位置结束增量，让已经追平的显示拿到半个旗帜字符。这里只保留确定仍需后续
 * 输入的片段：悬空的高位代理项、末尾连接符或奇数个区域指示符。
 */
function trimIncompleteTrailingCluster(text: string): string {
  if (text.length === 0) {
    return text;
  }

  const lastUnit = text.charCodeAt(text.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    return text.slice(0, -1);
  }
  if (lastUnit === ZERO_WIDTH_JOINER) {
    return text.slice(0, -1);
  }

  const trailingRegionalIndicators = countTrailingRegionalIndicators(text);
  if (trailingRegionalIndicators % 2 === 1) {
    return text.slice(0, -2);
  }

  return text;
}

/** 统计 `text` 末尾的区域指示符数量；一面旗帜由两个指示符组成。 */
function countTrailingRegionalIndicators(text: string): number {
  let count = 0;
  let cursor = text.length;
  while (cursor >= 2) {
    const codePoint = text.codePointAt(cursor - 2);
    if (codePoint === undefined || codePoint < 0x1f1e6 || codePoint > 0x1f1ff) {
      break;
    }
    count += 1;
    cursor -= 2;
  }
  return count;
}

/**
 * 返回本帧实际绘制的文本。`streaming` 表示仍会有后续内容；流式期间不完整尾部等待字素簇
 * 的剩余部分，回合结束后则显示全部已收到内容。
 */
export function visibleRevealedText(
  state: TextRevealState,
  options?: { streaming?: boolean },
): string {
  if (state.revealed >= state.target.length) {
    return options?.streaming ? trimIncompleteTrailingCluster(state.target) : state.target;
  }
  return state.target.slice(0, clampToSafeRevealBoundary(state.target, state.revealed));
}
