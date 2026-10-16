export interface ContentToggleRequest {
  itemId: string;
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
  const cancel = () => {
    revision += 1;
    if (frame !== null) cancelAnimationFrame(frame);
    if (timeout !== null) clearTimeout(timeout);
    frame = null;
    timeout = null;
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
      const restore = () => {
        frame = null;
        const currentMeasurement = ++measurement;
        // 卸载的原生单元可能不再返回回调，不能让一次测量阻断恢复。
        frame = requestAnimationFrame(restore);
        request.measure((nextTop) => {
          if (revision !== currentRevision || currentMeasurement <= lastAppliedMeasurement) return;
          lastAppliedMeasurement = currentMeasurement;
          if (nextTop === null) {
            return;
          }
          const delta = nextTop - top;
          if (Math.abs(delta) > 0.5) {
            port.setOffset(Math.max(0, port.getOffset() + (port.inverted ? -delta : delta)));
            stableFrames = 0;
          } else {
            stableFrames += 1;
          }
          if (stableFrames >= 4) cancel();
        });
      };
      frame = requestAnimationFrame(restore);
    });
  };
  return { preserve, cancel };
}
