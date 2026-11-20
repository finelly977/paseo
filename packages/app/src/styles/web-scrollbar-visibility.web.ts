import { shouldShowWebScrollbar } from "./web-scrollbar";

/** 只测量发生变化的滚动区域；流式文本更新不会反复扫描整个页面。 */
export function trackWebScrollbarVisibility(): () => void {
  const tracked = new Map<HTMLElement, ResizeObserver>();
  const dirty = new Set<HTMLElement>();
  const candidates = new Set<Element>();
  const trees = new Set<Element>();
  const contentChanges = new Set<HTMLElement>();
  let removed = false;
  let frame = 0;

  function flush() {
    frame = 0;
    if (removed) {
      for (const [element, observer] of tracked) {
        if (element.isConnected) continue;
        observer.disconnect();
        tracked.delete(element);
        dirty.delete(element);
      }
      removed = false;
    }
    for (const root of trees) {
      if (!root.isConnected) continue;
      candidates.add(root);
      for (const child of root.querySelectorAll("*")) candidates.add(child);
    }
    trees.clear();
    for (const element of candidates) {
      if (element.isConnected) discover(element);
    }
    candidates.clear();
    for (const element of contentChanges) {
      const observer = tracked.get(element);
      if (observer) observeContent(element, observer);
    }
    contentChanges.clear();
    // 所有几何读取先完成，再统一写入属性，避免下一个滚动区强制刷新前一个的样式。
    const measurements = [];
    for (const element of dirty) {
      if (!element.isConnected) continue;
      measurements.push({
        element,
        x: shouldShowWebScrollbar(element.clientWidth, element.scrollWidth),
        y: shouldShowWebScrollbar(element.clientHeight, element.scrollHeight),
      });
    }
    dirty.clear();
    for (const { element, x, y } of measurements) {
      if (element.hasAttribute("data-scrollbar-x") !== x) {
        element.toggleAttribute("data-scrollbar-x", x);
      }
      if (element.hasAttribute("data-scrollbar-y") !== y) {
        element.toggleAttribute("data-scrollbar-y", y);
      }
    }
  }

  function scheduleFrame() {
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function schedule(element: HTMLElement) {
    dirty.add(element);
    scheduleFrame();
  }

  function observeContent(element: HTMLElement, observer: ResizeObserver) {
    observer.disconnect();
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    dirty.add(element);
  }

  function discover(element: Element) {
    if (!(element instanceof HTMLElement) || tracked.has(element)) return;
    const style = getComputedStyle(element);
    if (
      element !== document.scrollingElement &&
      !/auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)
    )
      return;
    const observer = new ResizeObserver(() => schedule(element));
    tracked.set(element, observer);
    observeContent(element, observer);
  }

  function discoverTree(element: Element) {
    for (const root of trees) {
      if (root.contains(element)) return;
      if (element.contains(root)) trees.delete(root);
    }
    trees.add(element);
    scheduleFrame();
  }

  function invalidateAncestors(node: Node) {
    let element = node instanceof HTMLElement ? node : node.parentElement;
    while (element) {
      if (tracked.has(element)) schedule(element);
      element = element.parentElement;
    }
  }

  discoverTree(document.documentElement);
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      invalidateAncestors(record.target);
      if (record.type === "attributes" && record.target instanceof Element) {
        candidates.add(record.target);
        scheduleFrame();
      }
      if (record.type !== "childList") continue;
      removed ||= record.removedNodes.length > 0;
      for (const node of record.addedNodes) {
        if (node instanceof Element) discoverTree(node);
      }
      if (record.target instanceof HTMLElement) {
        contentChanges.add(record.target);
        scheduleFrame();
      }
    }
    if (removed) scheduleFrame();
  });
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
  });
  const onInput = (event: Event) => {
    if (event.target instanceof Node) invalidateAncestors(event.target);
  };
  document.addEventListener("input", onInput, true);
  document.addEventListener("load", onInput, true);
  return () => {
    mutations.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("load", onInput, true);
    for (const [element, observer] of tracked) {
      observer.disconnect();
      element.removeAttribute("data-scrollbar-x");
      element.removeAttribute("data-scrollbar-y");
    }
    tracked.clear();
    dirty.clear();
    candidates.clear();
    trees.clear();
    contentChanges.clear();
  };
}
