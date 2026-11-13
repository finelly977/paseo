import { shouldShowWebScrollbar } from "./web-scrollbar";

/** 只测量发生变化的滚动区域；流式文本更新不会反复扫描整个页面。 */
export function trackWebScrollbarVisibility(): () => void {
  const tracked = new Map<HTMLElement, ResizeObserver>();
  const dirty = new Set<HTMLElement>();
  let frame = 0;

  function flush() {
    frame = 0;
    for (const element of dirty) {
      if (!element.isConnected) continue;
      const x = shouldShowWebScrollbar(element.clientWidth, element.scrollWidth);
      const y = shouldShowWebScrollbar(element.clientHeight, element.scrollHeight);
      element.toggleAttribute("data-scrollbar-x", x);
      element.toggleAttribute("data-scrollbar-y", y);
    }
    dirty.clear();
  }

  function schedule(element: HTMLElement) {
    dirty.add(element);
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function observeContent(element: HTMLElement, observer: ResizeObserver) {
    observer.disconnect();
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    schedule(element);
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
    discover(element);
    for (const child of element.querySelectorAll("*")) discover(child);
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
    let removed = false;
    for (const record of records) {
      invalidateAncestors(record.target);
      if (record.type === "attributes" && record.target instanceof Element) discover(record.target);
      if (record.type !== "childList") continue;
      removed ||= record.removedNodes.length > 0;
      for (const node of record.addedNodes) {
        if (node instanceof Element) discoverTree(node);
      }
      if (record.target instanceof HTMLElement) {
        const observer = tracked.get(record.target);
        if (observer) observeContent(record.target, observer);
      }
    }
    if (removed) {
      for (const [element, observer] of tracked) {
        if (element.isConnected) continue;
        observer.disconnect();
        tracked.delete(element);
        dirty.delete(element);
      }
    }
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
  };
}
