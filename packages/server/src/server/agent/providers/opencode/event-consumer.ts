import {
  createOpencodeClient,
  type GlobalEvent,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

export type OpenCodeEventSourceInput =
  | GlobalEvent
  | { type: "reconnected" }
  | { type: "server-exited"; error: Error };

export interface OpenCodeEventSource {
  ready(): Promise<void>;
  subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void;
}

export interface OpenCodeEventConsumerTiming {
  arm(delayMs: number, callback: () => void): () => void;
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface OpenCodeEventConsumerOptions {
  serverUrl: string;
  processExit: Promise<Error>;
  logger: Logger;
  createClient?: (baseUrl: string) => OpencodeClient;
  timing?: OpenCodeEventConsumerTiming;
}

const WATCHDOG_MS = 30_000;
const MAX_BACKOFF_MS = 5_000;

const systemTiming: OpenCodeEventConsumerTiming = {
  arm(delayMs, callback) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
  wait(delayMs, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const handle = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(handle);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
};

export class OpenCodeEventConsumer implements OpenCodeEventSource {
  private readonly listeners = new Set<(input: OpenCodeEventSourceInput) => void>();
  private readonly client: OpencodeClient;
  private readonly logger: Logger;
  private readonly timing: OpenCodeEventConsumerTiming;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private connectionAbort = new AbortController();
  private connectionTask: Promise<void>;
  private connected = false;
  private closed = false;

  constructor(options: OpenCodeEventConsumerOptions) {
    this.logger = options.logger.child({ module: "agent", provider: "opencode-events" });
    this.client =
      options.createClient?.(options.serverUrl) ??
      createOpencodeClient({ baseUrl: options.serverUrl });
    this.timing = options.timing ?? systemTiming;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch((error) => {
      this.logger.error({ err: error }, "OpenCode 事件源在就绪前关闭");
    });
    this.connectionTask = this.consume(options.processExit);
    void this.connectionTask.catch((error) => {
      this.logger.error({ err: error }, "OpenCode 事件消费器意外停止");
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    const error = new Error("OpenCode 事件源已关闭");
    this.rejectReady(error);
    this.connectionAbort.abort(error);
    await this.connectionTask;
  }

  private async consume(processExit: Promise<Error>): Promise<void> {
    void processExit.then(
      (error) => this.exit(error),
      (error: unknown) => {
        const processExitError =
          error instanceof Error ? error : new Error(`OpenCode 进程退出失败：${String(error)}`);
        this.logger.error({ err: processExitError }, "OpenCode 进程退出观察器失败");
        this.exit(processExitError);
      },
    );
    let reconnectAttempt = 0;
    while (!this.closed) {
      let delivered = false;
      try {
        delivered = await this.consumeConnection(this.connectionAbort.signal);
      } catch (error) {
        if (this.closed) {
          this.logger.warn({ err: error }, "OpenCode 事件连接已随事件源关闭");
          return;
        }
        this.logger.warn(
          { err: error, reconnectAttempt: reconnectAttempt + 1 },
          "OpenCode 事件连接中断，将重试",
        );
      }
      if (this.closed) return;
      reconnectAttempt = delivered ? 0 : reconnectAttempt + 1;
      const delayMs = Math.min(100 * 2 ** Math.max(0, reconnectAttempt - 1), MAX_BACKOFF_MS);
      try {
        await this.timing.wait(delayMs, this.connectionAbort.signal);
      } catch (error) {
        if (this.closed) {
          this.logger.warn({ err: error, delayMs }, "OpenCode 事件重连等待已随事件源关闭");
          return;
        }
        this.logger.error({ err: error, delayMs }, "OpenCode 事件重连等待失败");
        throw error;
      }
    }
  }

  private async consumeConnection(signal: AbortSignal): Promise<boolean> {
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort(signal.reason);
    signal.addEventListener("abort", abortRequest, { once: true });
    let cancelWatchdog: () => void = () => undefined;
    let delivered = false;
    try {
      const result = await this.client.global.event({
        signal: requestAbort.signal,
        sseMaxRetryAttempts: 0,
      });
      const armWatchdog = () => {
        cancelWatchdog();
        cancelWatchdog = this.timing.arm(WATCHDOG_MS, () => requestAbort.abort());
      };
      armWatchdog();
      for await (const event of result.stream) {
        if (this.closed) return delivered;
        armWatchdog();
        if (!delivered) {
          delivered = true;
          if (this.connected) this.publish({ type: "reconnected" });
          this.connected = true;
          this.resolveReady();
        }
        this.publish(event);
      }
      return delivered;
    } finally {
      cancelWatchdog();
      signal.removeEventListener("abort", abortRequest);
      requestAbort.abort();
    }
  }

  private exit(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.connectionAbort.abort(error);
    if (!this.connected) this.rejectReady(error);
    this.publish({ type: "server-exited", error });
    this.listeners.clear();
  }

  private publish(input: OpenCodeEventSourceInput): void {
    for (const listener of this.listeners) {
      try {
        listener(input);
      } catch (error) {
        this.logger.error({ err: error }, "OpenCode 事件监听器失败，共享事件传输保持运行");
      }
    }
  }
}

export type OpenCodeEventConsumerFactory = (
  options: Pick<OpenCodeEventConsumerOptions, "serverUrl" | "processExit">,
) => OpenCodeEventConsumer;
