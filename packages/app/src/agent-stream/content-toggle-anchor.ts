export interface ProcessMotionToggle {
  turnId: string;
  expanded: boolean;
}

export interface ContentToggleRequest {
  itemId: string;
  process?: ProcessMotionToggle;
  measure: (callback: (top: number | null) => void) => void;
  applyChange: () => void;
}

export interface ContentToggleAnchorPort {
  inverted: boolean;
  getOffset: () => number;
  setOffset: (offset: number) => void;
  detach: () => void;
  setActive: (active: boolean) => void;
}

// 展开是用户正在阅读入口附近内容的明确意图，不能继续由底部跟随或默认行锚点接管。
export function createContentToggleAnchor(port: ContentToggleAnchorPort) {
  let revision = 0;
  let frame: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let restorePending: (() => void) | null = null;
  const cancel = () => {
    revision += 1;
    if (frame !== null) cancelAnimationFrame(frame);
    if (timeout !== null) clearTimeout(timeout);
    frame = null;
    timeout = null;
    restorePending = null;
    port.setActive(false);
  };
  const preserve = (request: ContentToggleRequest) => {
    cancel();
    const currentRevision = revision;
    // 无法测量表示入口已因切换标签或卸载离开屏幕，取消过期点击。
    request.measure((top) => {
      if (revision !== currentRevision || top === null) return;
      port.detach();
      port.setActive(true);
      let stableFrames = 0;
      timeout = setTimeout(() => {
        console.warn("[AgentStream] 过程入口未在限定时间内恢复", { itemId: request.itemId });
        cancel();
      }, 8_000);
      request.applyChange();
      let measurement = 0;
      let lastAppliedMeasurement = 0;
      let previousTop: number | null = null;
      const correctPosition = (countStableFrame: boolean) => {
        const currentMeasurement = ++measurement;
        request.measure((nextTop) => {
          if (revision !== currentRevision || currentMeasurement <= lastAppliedMeasurement) return;
          lastAppliedMeasurement = currentMeasurement;
          if (nextTop === null) {
            return;
          }
          const delta = nextTop - top;
          if (Math.abs(delta) > 0.5) {
            const beforeOffset = port.getOffset();
            port.setOffset(Math.max(0, beforeOffset + (port.inverted ? -delta : delta)));
            const clamped = Math.abs(port.getOffset() - beforeOffset) <= 0.5;
            if (
              clamped &&
              countStableFrame &&
              previousTop !== null &&
              Math.abs(nextTop - previousTop) <= 0.5
            ) {
              // 滚动条已顶到边界无法继续补偿，位置连续稳定后正常结束锚定，避免空等超时。
              stableFrames += 1;
            } else {
              stableFrames = 0;
            }
          } else if (countStableFrame) {
            stableFrames += 1;
          }
          previousTop = nextTop;
          if (stableFrames >= 4) cancel();
        });
      };
      const restore = () => {
        frame = null;
        // 卸载的原生单元可能不再返回回调，不能让一次测量阻断恢复。
        frame = requestAnimationFrame(restore);
        correctPosition(true);
      };
      restorePending = () => correctPosition(false);
      frame = requestAnimationFrame(restore);
    });
  };
  return { preserve, cancel, restore: () => restorePending?.() };
}
