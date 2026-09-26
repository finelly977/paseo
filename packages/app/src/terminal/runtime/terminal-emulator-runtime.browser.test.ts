import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalInputModeState } from "@getpaseo/protocol/terminal-input-mode";
import { encodeTerminalOutput, TerminalEmulatorRuntime } from "./terminal-emulator-runtime";
import { darkTheme, lightTheme } from "@/styles/theme";

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class WebglAddon {
    activate(): void {}
    dispose(): void {}
    onContextLoss(): void {}
  },
}));

interface TerminalSize {
  rows: number;
  cols: number;
  shouldClaim: boolean;
}

interface TerminalKeyRecord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

type BrowserTerminal = TerminalSize & {
  refresh: (start: number, end: number) => void;
  reset: () => void;
};

interface MountedTerminal {
  host: HTMLDivElement;
  root: HTMLDivElement;
  runtime: TerminalEmulatorRuntime;
  inputs: string[];
  sizes: TerminalSize[];
  terminalKeys: TerminalKeyRecord[];
  inputModeChanges: TerminalInputModeState[];
}

const mountedTerminals: MountedTerminal[] = [];

function colorLuminance(cssColor: string): number {
  const channels = cssColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  if (!channels) throw new Error(`无法读取终端显示颜色：${cssColor}`);
  const [red, green, blue] = channels.slice(1).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function renderedTextContrast(host: HTMLElement, text: string): number {
  const span = Array.from(host.querySelectorAll<HTMLElement>(".xterm-rows span")).find(
    (element) => element.textContent === text,
  );
  if (!span) throw new Error(`终端没有显示预期文字：${text}`);
  const foreground = colorLuminance(getComputedStyle(span).color);
  const background = colorLuminance(getComputedStyle(host).backgroundColor);
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function terminalOutput(text: string): Uint8Array {
  return encodeTerminalOutput(text);
}

async function waitFor(input: { predicate: () => boolean; timeoutMs?: number }): Promise<void> {
  const startedAt = performance.now();
  const timeoutMs = input.timeoutMs ?? 2_000;

  while (!input.predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for terminal browser condition");
    }
    await nextFrame();
  }
}

function settleMountRefits(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2_600));
}

function createTerminalHost(input: {
  width: number;
  height: number;
  scrollback?: number;
}): MountedTerminal {
  const root = document.createElement("div");
  root.style.width = `${input.width}px`;
  root.style.height = `${input.height}px`;
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.overflow = "hidden";

  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  root.appendChild(host);
  document.body.appendChild(root);

  const sizes: TerminalSize[] = [];
  const inputs: string[] = [];
  const terminalKeys: TerminalKeyRecord[] = [];
  const inputModeChanges: TerminalInputModeState[] = [];
  const runtime = new TerminalEmulatorRuntime();
  runtime.setCallbacks({
    callbacks: {
      onInput: (data) => {
        inputs.push(data);
      },
      onResize: (size) => {
        sizes.push(size);
      },
      onTerminalKey: (key) => {
        terminalKeys.push(key);
      },
      onInputModeChange: (state) => {
        inputModeChanges.push(state);
      },
    },
  });
  runtime.mount({
    root,
    host,
    initialSnapshot: null,
    scrollback: input.scrollback ?? 10_000,
    theme: {
      background: "#0b0b0b",
      foreground: "#e6e6e6",
      cursor: "#e6e6e6",
    },
  });

  const mounted = { host, root, runtime, inputs, sizes, terminalKeys, inputModeChanges };
  mountedTerminals.push(mounted);
  return mounted;
}

function latestSize(sizes: TerminalSize[]): TerminalSize {
  const size = sizes.at(-1);
  if (!size) {
    throw new Error("Terminal did not report a size");
  }
  return size;
}

function getBrowserTerminal(): BrowserTerminal {
  const terminal = window.__paseoTerminal as BrowserTerminal | undefined;
  if (!terminal) {
    throw new Error("Expected xterm to be exposed for browser test inspection");
  }
  return terminal;
}

function dispatchTerminalKey(input: {
  host: HTMLElement;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): boolean {
  const textarea = input.host.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Expected xterm textarea to be mounted");
  }
  textarea.focus();
  return textarea.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: input.key,
      shiftKey: input.shiftKey ?? false,
      ctrlKey: input.ctrlKey ?? false,
      altKey: input.altKey ?? false,
      metaKey: input.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  for (const mounted of mountedTerminals.splice(0)) {
    mounted.runtime.unmount();
    mounted.root.remove();
  }
});

describe("terminal emulator runtime in a real browser", () => {
  it.each([
    { name: "ANSI 亮黑色", code: "90" },
    { name: "256 色深灰", code: "38;5;238" },
    { name: "RGB 深灰", code: "38;2;42;42;42" },
  ])("让 $name 命令预测在深色背景上保持可读", async ({ code }) => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });
    mounted.runtime.setTheme({ theme: darkTheme.colors.terminal });
    const suggestion = "status --short";
    mounted.runtime.write({ data: terminalOutput(`$ git \x1b[${code}m${suggestion}\x1b[0m\r\n`) });
    await waitFor({ predicate: () => mounted.host.textContent?.includes(suggestion) === true });

    expect(renderedTextContrast(mounted.host, suggestion)).toBeGreaterThanOrEqual(4.5);
    expect(mounted.inputs).toEqual([]);
  });

  it("已打开的终端切换浅色主题后也会校正低对比度预测文字", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });
    const suggestion = "status --short";
    mounted.runtime.setTheme({ theme: darkTheme.colors.terminal });
    mounted.runtime.write({
      data: terminalOutput(`$ git \x1b[38;2;230;230;230m${suggestion}\x1b[0m\r\n`),
    });
    await waitFor({ predicate: () => mounted.host.textContent?.includes(suggestion) === true });
    const terminal = window.__paseoTerminal;
    mounted.runtime.setTheme({ theme: lightTheme.colors.terminal });
    await nextFrame();
    await nextFrame();

    expect(window.__paseoTerminal).toBe(terminal);
    expect(renderedTextContrast(mounted.host, suggestion)).toBeGreaterThanOrEqual(4.5);
    expect(mounted.inputs).toEqual([]);
  });

  it("passes configured scrollback to xterm", async () => {
    await page.viewport(900, 600);
    createTerminalHost({ width: 720, height: 360, scrollback: 42_000 });

    await waitFor({
      predicate: () => window.__paseoTerminal !== undefined,
    });

    expect(window.__paseoTerminal?.options.scrollback).toBe(42_000);
  });

  it("updates scrollback on the mounted xterm", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360, scrollback: 10_000 });

    await waitFor({
      predicate: () => window.__paseoTerminal !== undefined,
    });
    const terminal = window.__paseoTerminal;

    mounted.runtime.setScrollback({ lines: 42_000 });

    expect(window.__paseoTerminal).toBe(terminal);
    expect(window.__paseoTerminal?.options.scrollback).toBe(42_000);
  });

  it("does not claim PTY ownership from passive mount refits", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    await settleMountRefits();

    expect(mounted.sizes.length).toBeGreaterThan(1);
    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([]);

    const settledSize = latestSize(mounted.sizes);
    mounted.runtime.resize({ force: true, shouldClaim: true });

    expect(mounted.sizes.filter((size) => size.shouldClaim)).toEqual([
      { ...settledSize, shouldClaim: true },
    ]);
  });

  it("reports a larger PTY size when the terminal container grows", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 360, height: 180 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });
    const initialSize = latestSize(mounted.sizes);

    mounted.root.style.width = "720px";
    mounted.root.style.height = "360px";
    await nextFrame();
    mounted.runtime.resize({ force: true });

    await waitFor({
      predicate: () => {
        const size = latestSize(mounted.sizes);
        return size.cols > initialSize.cols && size.rows > initialSize.rows;
      },
    });

    const grownSize = latestSize(mounted.sizes);
    expect(grownSize.cols).toBeGreaterThan(initialSize.cols);
    expect(grownSize.rows).toBeGreaterThan(initialSize.rows);
    expect(grownSize.shouldClaim).toBe(true);
  });

  it("refreshes visible rows on a forced same-size resize", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    const terminal = getBrowserTerminal();
    const refreshCalls: Array<[number, number]> = [];
    const originalRefresh = terminal.refresh.bind(terminal);
    terminal.refresh = (start, end) => {
      refreshCalls.push([start, end]);
      originalRefresh(start, end);
    };

    mounted.runtime.resize({ force: true });

    await waitFor({ predicate: () => refreshCalls.length > 0 });
    expect(refreshCalls.at(-1)).toEqual([0, terminal.rows - 1]);
  });

  it("intercepts Shift+Enter only after enhanced terminal input mode is active", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([]);

    mounted.runtime.write({ data: terminalOutput("\x1b[>7u") });
    await waitFor({
      predicate: () =>
        mounted.inputModeChanges.some(
          (state) => state.kittyKeyboardFlags === 7 && !state.win32InputMode,
        ),
    });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([
      {
        key: "Enter",
        ctrl: false,
        shift: true,
        alt: false,
        meta: false,
      },
    ]);

    mounted.terminalKeys.length = 0;
    mounted.runtime.write({ data: terminalOutput("\x1b[=0;0u\x1b[?9001h") });
    await waitFor({
      predicate: () =>
        mounted.inputModeChanges.some(
          (state) => state.kittyKeyboardFlags === 0 && state.win32InputMode,
        ),
    });

    dispatchTerminalKey({
      host: mounted.host,
      key: "Enter",
      shiftKey: true,
    });
    await nextFrame();

    expect(mounted.terminalKeys).toEqual([
      {
        key: "Enter",
        ctrl: false,
        shift: true,
        alt: false,
        meta: false,
      },
    ]);
  });

  it.each([
    { name: "DA1", bytes: "\x1b[c" },
    { name: "DA1-zero", bytes: "\x1b[0c" },
    { name: "DA2", bytes: "\x1b[>c" },
    { name: "DA3", bytes: "\x1b[=c" },
    { name: "DSR-5", bytes: "\x1b[5n" },
    { name: "DSR-6", bytes: "\x1b[6n" },
    { name: "DSR-?6", bytes: "\x1b[?6n" },
    { name: "DECRQM", bytes: "\x1b[1$p" },
    { name: "DECRQM-?", bytes: "\x1b[?1$p" },
    { name: "OSC-10-foreground-color", bytes: "\x1b]10;?\x07" },
    { name: "OSC-11-background-color", bytes: "\x1b]11;?\x07" },
    { name: "OSC-12-cursor-color", bytes: "\x1b]12;?\x07" },
  ])("does not emit a PTY input reply for $name", async ({ bytes }) => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    mounted.runtime.write({ data: terminalOutput(bytes) });
    await nextFrame();
    await nextFrame();

    expect(mounted.inputs).toEqual([]);
  });

  it("replays snapshots without synchronously resetting the visible terminal", async () => {
    await page.viewport(900, 600);
    const mounted = createTerminalHost({ width: 720, height: 360 });

    await waitFor({ predicate: () => mounted.sizes.length > 0 });

    const terminal = getBrowserTerminal();
    const originalReset = terminal.reset.bind(terminal);
    const reset = vi.fn(originalReset);
    terminal.reset = reset;

    mounted.runtime.renderSnapshot({
      state: {
        rows: terminal.rows,
        cols: terminal.cols,
        scrollback: [],
        grid: [
          [
            { char: "p" },
            { char: "r" },
            { char: "o" },
            { char: "m" },
            { char: "p" },
            { char: "t" },
          ],
        ],
        cursor: {
          row: 0,
          col: 6,
        },
      },
    });
    await nextFrame();

    expect(reset).not.toHaveBeenCalled();
  });
});
