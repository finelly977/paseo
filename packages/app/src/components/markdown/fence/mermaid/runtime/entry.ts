import mermaid from "mermaid";
import {
  parseMermaidRuntimeRenderMessage,
  type MermaidRuntimeMessage,
  type MermaidRuntimeRenderMessage,
} from "./messages";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __PASEO_MERMAID_RUNTIME_RECEIVE__?: (message: unknown) => void;
  }
}

function sendToHost(message: MermaidRuntimeMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function initializeMermaid(colorScheme: "light" | "dark"): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: colorScheme === "dark" ? "dark" : "default",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "theme",
      "themeVariables",
      "themeCSS",
    ],
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
  });
}

function setViewport(interactive: boolean): void {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      interactive
        ? "width=device-width, initial-scale=1, maximum-scale=8"
        : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );
}

let latestRevision = 0;
let pendingRender: MermaidRuntimeRenderMessage | null = null;
let isRendering = false;
let isDrainScheduled = false;

async function render(message: MermaidRuntimeRenderMessage): Promise<void> {
  try {
    initializeMermaid(message.colorScheme);
    const { svg } = await mermaid.render(`paseo-mermaid-${message.revision}`, message.source);
    if (message.revision !== latestRevision) {
      return;
    }
    setViewport(message.interactive);
    const host = document.getElementById("diagram");
    if (!host) {
      throw new Error("Mermaid diagram host is missing");
    }
    host.innerHTML = svg;
    const diagram = host.querySelector("svg");
    if (!diagram) throw new Error("Mermaid produced no SVG diagram");
    // 测量容器尚未布局时可能只有几像素宽，不能把缩放后的边界当成图表原始尺寸。
    const { width, height } = diagram.viewBox.baseVal;
    if (width <= 0 || height <= 0) throw new Error("Mermaid produced an invalid SVG viewBox");
    diagram.style.width = "100%";
    diagram.style.height = message.interactive ? "auto" : "100%";
    diagram.style.maxWidth = "none";
    sendToHost({
      type: "rendered",
      revision: message.revision,
      source: message.source,
      colorScheme: message.colorScheme,
      height: Math.ceil(height),
      width: Math.ceil(width),
    });
  } catch (error) {
    console.error("Mermaid diagram rendering failed", error);
    if (message.revision === latestRevision) {
      sendToHost({ type: "renderError", revision: message.revision });
    }
  }
}

async function drainRenderQueue(): Promise<void> {
  if (isRendering) {
    return;
  }
  isRendering = true;
  try {
    while (pendingRender) {
      const next = pendingRender;
      pendingRender = null;
      await render(next);
    }
  } finally {
    isRendering = false;
  }
}

function receiveRender(value: unknown): void {
  const message = parseMermaidRuntimeRenderMessage(value);
  if (!message) {
    return;
  }
  latestRevision = message.revision;
  pendingRender = message;
  if (isRendering || isDrainScheduled) {
    return;
  }
  isDrainScheduled = true;
  window.setTimeout(() => {
    isDrainScheduled = false;
    void drainRenderQueue();
  }, 0);
}

window.__PASEO_MERMAID_RUNTIME_RECEIVE__ = receiveRender;
window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    receiveRender(event.data);
  }
});

sendToHost({ type: "bridgeReady" });
