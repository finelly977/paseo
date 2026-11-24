import { MOTION_DURATION } from "@/styles/motion";
import type { ProcessMotionToggle } from "./content-toggle-anchor";

const PROCESS_EASING = "cubic-bezier(0.35, 0, 0.55, 1)";
const GEOMETRY_TOLERANCE = 2;
export const PROCESS_SCROLL_ANCHOR_VAR = "--paseo-process-scroll-anchor";

function findProcessMotionAnchor(scroll: HTMLElement, turnId: string) {
  const id = CSS.escape(turnId);
  return scroll.querySelector<HTMLElement>(
    `[data-testid="completed-process-${id}"], [data-testid="native-process-${id}"] [data-testid="conversation-divider"]`,
  );
}

function readSlice(scroll: HTMLElement, turnId: string) {
  const anchor = findProcessMotionAnchor(scroll, turnId);
  if (!anchor) return null;
  const viewport = scroll.getBoundingClientRect();
  const divider = anchor.getBoundingClientRect();
  const top = divider.bottom - viewport.top;
  if (divider.height === 0 || top < 0 || top >= scroll.clientHeight - GEOMETRY_TOLERANCE) {
    return null;
  }
  return { top, height: scroll.clientHeight - top, width: scroll.clientWidth };
}

type Slice = NonNullable<ReturnType<typeof readSlice>>;

function sameSlice(a: Slice, b: Slice) {
  return (
    Math.abs(a.top - b.top) < GEOMETRY_TOLERANCE &&
    Math.abs(a.height - b.height) < GEOMETRY_TOLERANCE &&
    a.width === b.width
  );
}

function firstIntersectingRow(rows: HTMLCollection, top: number) {
  let first = 0;
  let end = rows.length;
  while (first < end) {
    const middle = (first + end) >>> 1;
    if (rows[middle].getBoundingClientRect().bottom <= top) first = middle + 1;
    else end = middle;
  }
  return first;
}

// 两张临时绘制层只复制视口内的 DOM，不挂 React 树，也不参与时间线测量。
function captureSlice(scroll: HTMLElement, content: HTMLElement, turnId: string) {
  const slice = readSlice(scroll, turnId);
  const history = content.querySelector("[data-history-rows]");
  if (!slice || !history) return null;
  const viewport = scroll.getBoundingClientRect();
  const top = viewport.top + slice.top;
  const bottom = top + slice.height;
  const firstBody = history.querySelector(
    `[data-process-turn-id="${CSS.escape(turnId)}"], [data-process-motion-content="${CSS.escape(turnId)}"]`,
  );
  const bodyOffset = firstBody ? Math.max(0, firstBody.getBoundingClientRect().top - top) : null;
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden";
  const rows = new Map<string, number>();
  const nestedScrolls: { node: HTMLElement; top: number; left: number }[] = [];
  const candidates = Array.from(content.children);
  for (
    let index = firstIntersectingRow(history.children, top);
    index < history.children.length;
    index += 1
  ) {
    const node = history.children[index];
    if (node.getBoundingClientRect().top >= bottom) break;
    candidates.push(node);
  }
  for (const node of candidates) {
    if (
      !(node instanceof HTMLElement) ||
      node === history ||
      node.hasAttribute("data-virtual-spacer") ||
      node.dataset.testid === "load-older-history-spinner"
    ) {
      continue;
    }
    const bounds = node.getBoundingClientRect();
    if (bounds.height === 0 || bounds.bottom <= top || bounds.top >= bottom) continue;
    // 不重建视口里正在运行的嵌入页面、媒体或画布。
    if (node.querySelector("iframe, object, embed, video, audio, canvas")) return null;
    const offset = bounds.top - top;
    const id = node.dataset.streamRowId;
    if (id && offset >= -GEOMETRY_TOLERANCE) rows.set(id, offset);
    const copy = node.cloneNode(true) as HTMLElement;
    for (const element of [
      copy,
      ...copy.querySelectorAll(
        "[id], [data-testid], [data-process-turn-id], [data-process-motion-content], [autofocus]",
      ),
    ]) {
      // 投影不能被时间线、无障碍或自动聚焦当成真实正文。SVG 内部引用保持完整。
      if (!(element instanceof SVGElement)) element.removeAttribute("id");
      element.removeAttribute("data-testid");
      element.removeAttribute("data-process-turn-id");
      element.removeAttribute("data-process-motion-content");
      element.removeAttribute("autofocus");
    }
    copy.removeAttribute("data-stream-row-id");
    copy.removeAttribute("data-index");
    const scrollers = node.querySelectorAll<HTMLElement>("[data-code-scroll-viewport]");
    if (scrollers.length > 0) {
      const copies = copy.querySelectorAll<HTMLElement>("[data-code-scroll-viewport]");
      scrollers.forEach((source, index) => {
        if (source.scrollTop !== 0 || source.scrollLeft !== 0) {
          nestedScrolls.push({
            node: copies[index],
            top: source.scrollTop,
            left: source.scrollLeft,
          });
        }
      });
    }
    Object.assign(copy.style, {
      position: "absolute",
      margin: "0",
      left: `${bounds.left - viewport.left}px`,
      top: `${offset}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    layer.append(copy);
  }
  return { slice, layer, rows, nestedScrolls, bodyOffset };
}

type Picture = NonNullable<ReturnType<typeof captureSlice>>;

function getTravel(collapsed: Picture, expanded: Picture, height: number) {
  // 短过程的后续回复走实际落位距离；回复离屏时，把位移限制在这一屏。
  for (const [id, before] of collapsed.rows) {
    const after = expanded.rows.get(id);
    if (after !== undefined && after > before + GEOMETRY_TOLERANCE) {
      return Math.min(height, after - before);
    }
  }
  return height;
}

function play(animations: readonly Animation[], expanded: boolean, from: number) {
  const now = document.timeline.currentTime;
  if (typeof now !== "number") return;
  const rate = expanded ? 1 : -MOTION_DURATION.base / MOTION_DURATION.fast;
  const position = Math.max(0, Math.min(from, MOTION_DURATION.base));
  for (const animation of animations) {
    animation.playbackRate = rate;
    animation.startTime = now - position / rate;
  }
}

function clipLiveContent(scroll: HTMLElement, content: HTMLElement, top: number) {
  const cut = scroll.getBoundingClientRect().top + top - content.getBoundingClientRect().top;
  content.style.clipPath = `inset(0 0 calc(100% - ${cut}px) 0)`;
}

/** 布局先一次落定；开合期间只在入口下方合成两张有共同边界的绘制层。 */
export function createProcessMotion() {
  let pending: { toggle: ProcessMotionToggle; before: Picture | null } | null = null;
  let active: {
    turnId: string;
    slice: Slice;
    top: number;
    scroll: HTMLElement;
    scrollTop: number;
    mask: Animation;
    slide: Animation;
    content: HTMLElement;
    deck: HTMLElement;
  } | null = null;
  let resumeNativeAnchor: number | null = null;

  function holdNativeAnchor(scroll: HTMLElement) {
    if (resumeNativeAnchor !== null) cancelAnimationFrame(resumeNativeAnchor);
    resumeNativeAnchor = null;
    scroll.style.setProperty(PROCESS_SCROLL_ANCHOR_VAR, "none");
  }

  function cancel() {
    pending = null;
    if (!active) return;
    const { mask, slide, content, deck, scroll } = active;
    active = null;
    content.style.removeProperty("clip-path");
    mask.cancel();
    slide.cancel();
    deck.remove();
    // 解除裁剪后的首帧仍由过程入口负责锚定；避免浏览器改选历史行并补偿已经落定的布局。
    const resume = () => {
      scroll.style.removeProperty(PROCESS_SCROLL_ANCHOR_VAR);
      resumeNativeAnchor = null;
    };
    const afterPaint = () => {
      resumeNativeAnchor = requestAnimationFrame(resume);
    };
    resumeNativeAnchor = requestAnimationFrame(afterPaint);
  }

  function syncActive(scroll: HTMLElement) {
    if (!active) return;
    const current = readSlice(scroll, active.turnId);
    if (!current || !sameSlice(active.slice, current)) {
      cancel();
      return;
    }
    if (active.scrollTop !== scroll.scrollTop) {
      active.scrollTop = scroll.scrollTop;
      clipLiveContent(scroll, active.content, active.top);
    }
  }

  return {
    cancel,
    isOnTrigger(scroll: HTMLElement, target: EventTarget | null) {
      const turnId = active?.turnId;
      return !!(
        turnId &&
        target instanceof Node &&
        findProcessMotionAnchor(scroll, turnId)?.contains(target)
      );
    },
    beforeChange(
      scroll: HTMLElement,
      content: HTMLElement,
      toggle: ProcessMotionToggle | undefined,
      enabled: boolean,
    ) {
      if (!toggle || !enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        cancel();
        return;
      }
      if (active?.turnId === toggle.turnId) {
        pending = { toggle, before: null };
        return;
      }
      cancel();
      const before = captureSlice(scroll, content, toggle.turnId);
      if (before) pending = { toggle, before };
    },
    afterChange(scroll: HTMLElement, content: HTMLElement, overlay: HTMLElement) {
      const change = pending;
      pending = null;
      if (!change) {
        syncActive(scroll);
        return;
      }
      const { toggle, before } = change;
      const slice = readSlice(scroll, toggle.turnId);
      if (!slice) {
        cancel();
        return;
      }
      if (active && !before) {
        if (!sameSlice(active.slice, slice)) {
          cancel();
          return;
        }
        const from = active.mask.currentTime;
        if (typeof from !== "number") {
          cancel();
          return;
        }
        active.scrollTop = scroll.scrollTop;
        clipLiveContent(scroll, content, active.top);
        play([active.mask, active.slide], toggle.expanded, from);
        return;
      }
      if (!before || !sameSlice(before.slice, slice) || document.timeline.currentTime === null)
        return;
      const after = captureSlice(scroll, content, toggle.turnId);
      if (!after) return;
      const full = toggle.expanded ? after : before;
      const folded = toggle.expanded ? before : after;
      if (full.bodyOffset === null || full.bodyOffset >= slice.height - GEOMETRY_TOLERANCE) return;
      // 有的回合先给答复才执行收尾命令；不把分割线与首条过程之间的正文一起滑动或重绘。
      const prefix = full.bodyOffset;
      const top = slice.top + prefix;
      const height = slice.height - prefix;
      const travel = getTravel(folded, full, height);
      if (prefix > 0) {
        for (const child of [...full.layer.children, ...folded.layer.children]) {
          if (child instanceof HTMLElement) {
            child.style.top = `${Number.parseFloat(child.style.top) - prefix}px`;
          }
        }
      }
      const deck = document.createElement("div");
      deck.dataset.processMotion = toggle.turnId;
      deck.style.cssText = `position:absolute;left:0;top:${top}px;width:${slice.width}px;height:${height}px;overflow:hidden`;
      // 两层在同一水平线相接：上半截是刚露出的过程，下半截是同步退让的回复。
      deck.append(full.layer, folded.layer);
      overlay.append(deck);
      for (const { node, top: scrollTop, left } of [
        ...full.nestedScrolls,
        ...folded.nestedScrolls,
      ]) {
        node.scrollTop = scrollTop;
        node.scrollLeft = left;
      }
      const timing: KeyframeAnimationOptions = {
        duration: MOTION_DURATION.base,
        easing: PROCESS_EASING,
        fill: "both",
      };
      const hiddenPercentage = (1 - travel / height) * 100;
      const mask = full.layer.animate(
        [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: `inset(0 0 ${hiddenPercentage}% 0)` }],
        timing,
      );
      const slide = folded.layer.animate(
        [{ transform: "translateY(0)" }, { transform: `translateY(${travel}px)` }],
        timing,
      );
      holdNativeAnchor(scroll);
      clipLiveContent(scroll, content, top);
      const motion = {
        turnId: toggle.turnId,
        slice,
        top,
        scroll,
        scrollTop: scroll.scrollTop,
        mask,
        slide,
        content,
        deck,
      };
      active = motion;
      mask.onfinish = () => {
        if (active === motion) cancel();
      };
      play([mask, slide], toggle.expanded, toggle.expanded ? 0 : MOTION_DURATION.base);
    },
    onScroll(scroll: HTMLElement) {
      if (active && active.scrollTop !== scroll.scrollTop) syncActive(scroll);
    },
  };
}
