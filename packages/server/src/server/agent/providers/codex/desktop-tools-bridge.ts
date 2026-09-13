import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { Logger } from "pino";
import { z } from "zod";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const RpcIdSchema = z.union([z.string(), z.number()]);
const RpcRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: RpcIdSchema,
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export const DesktopMessageSchema = z.union([
  RpcRequestSchema,
  z.strictObject({ jsonrpc: z.literal("2.0"), id: RpcIdSchema, result: z.json() }),
  z.strictObject({
    jsonrpc: z.literal("2.0"),
    id: RpcIdSchema,
    error: z.object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    }),
  }),
]);
export type DesktopRpcRequest = z.infer<typeof RpcRequestSchema>;

const NativeRequestSchema = z.object({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  codexTurnMetadata: z
    .object({
      session_id: z.string().min(1),
      turn_id: z.string().min(1),
    })
    .passthrough()
    .nullish(),
});
const ApprovalSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.unknown().optional(),
    _meta: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough();

type Approval = z.infer<typeof ApprovalSchema>;

export interface DesktopHelperRequestOptions {
  codexTurnMetadata?: unknown;
  createElicitation(request: unknown): Promise<Approval>;
}

export interface DesktopHelper {
  request(
    method: string,
    params: Record<string, unknown>,
    options: DesktopHelperRequestOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export class DesktopHelperTransportError extends Error {
  constructor(cause: unknown) {
    super("Codex desktop SDK host disconnected", { cause });
    this.name = "DesktopHelperTransportError";
  }
}

export interface CodexDesktopBridge {
  pipePath: string;
  endTurn(turn: DesktopToolTurn): Promise<void>;
  dispose(): Promise<void>;
}

export interface DesktopToolTurn {
  sessionId: string;
  turnId: string;
}

interface PendingApproval {
  socket: Socket;
  resolve(value: Approval): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

interface BridgeOptions {
  pipePath: string;
  createHelper(): Promise<DesktopHelper>;
  logger: Logger;
}

interface ActiveRequest {
  message: DesktopRpcRequest;
  canceled: boolean;
}

function send(socket: Socket, message: unknown): void {
  if (socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(message), "utf8");
  const frame = Buffer.allocUnsafe(data.length + 4);
  frame.writeUInt32LE(data.length, 0);
  data.copy(frame, 4);
  socket.write(frame);
}

export async function startCodexDesktopBridge(options: BridgeOptions): Promise<CodexDesktopBridge> {
  const sockets = new Set<Socket>();
  const approvals = new Map<string, PendingApproval>();
  let helper: Promise<DesktopHelper> | null = null;
  let closingHelper: Promise<void> = Promise.resolve();
  let helperOwner: Socket | null = null;
  let helperOwnerTurn: string | null = null;
  let activeRequest: ActiveRequest | null = null;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  async function getHelper(request: ActiveRequest): Promise<DesktopHelper> {
    await closingHelper;
    if (disposed) throw new Error("Paseo desktop tools are shutting down");
    if (request.canceled) throw new Error("Desktop tool request was canceled during startup");
    helper ??= options.createHelper();
    const pending = helper;
    try {
      return await pending;
    } catch (error) {
      if (helper === pending) helper = null;
      throw error;
    }
  }

  function closeHelper(): Promise<void> {
    if (activeRequest !== null) activeRequest.canceled = true;
    const current = helper;
    helper = null;
    helperOwner = null;
    helperOwnerTurn = null;
    if (current !== null)
      closingHelper = current.then(
        (runtime) => runtime.close(),
        (error) => {
          options.logger.error({ err: error }, "Desktop helper creation failed before cleanup");
        },
      );
    return closingHelper;
  }

  function rejectApprovals(socket: Socket, error: Error): void {
    for (const [id, approval] of approvals) {
      if (approval.socket !== socket) continue;
      approvals.delete(id);
      clearTimeout(approval.timeout);
      approval.reject(error);
    }
  }

  function requestApproval(socket: Socket, params: unknown): Promise<Approval> {
    if (socket.destroyed || disposed)
      return Promise.reject(new Error("Desktop approval connection closed"));
    return new Promise((resolve, reject) => {
      const id = `computer-use-approval:paseo-${randomUUID()}`;
      const timeout = setTimeout(() => {
        approvals.delete(id);
        reject(new Error("Desktop application approval timed out"));
      }, APPROVAL_TIMEOUT_MS);
      timeout.unref();
      approvals.set(id, { socket, resolve, reject, timeout });
      send(socket, { jsonrpc: "2.0", id, method: "requestComputerUseApproval", params });
    });
  }

  async function executeRequest(socket: Socket, message: DesktopRpcRequest): Promise<unknown> {
    if (message.method === "ping") {
      return "pong";
    }
    const native = message.method === "request" ? NativeRequestSchema.parse(message.params) : null;
    const metadata = native?.codexTurnMetadata;
    const turn = metadata == null ? null : `${metadata.session_id}\0${metadata.turn_id}`;
    const isCleanup = message.method === "close" || native?.method === "end_turn";
    if (isCleanup) {
      // 旧连接和迟到的回合结束事件不能停止当前回合。
      const ownsCurrentTurn = helperOwner === socket && (turn === null || helperOwnerTurn === turn);
      if (ownsCurrentTurn) {
        rejectApprovals(socket, new Error("Desktop tool turn ended"));
        await closeHelper();
      }
      return null;
    }
    if (native === null) throw new Error(`Unsupported desktop bridge method: ${message.method}`);
    if (activeRequest !== null) throw new Error("Another desktop tool request is already running");
    const request = { message, canceled: false };
    activeRequest = request;
    helperOwner = socket;
    helperOwnerTurn = turn;
    const runtime = await getHelper(request);
    if (socket.destroyed || disposed || request.canceled) {
      await closeHelper();
      throw new Error("Desktop tool request was canceled during startup");
    }
    return runtime.request(native.method, native.params ?? {}, {
      codexTurnMetadata: native.codexTurnMetadata,
      createElicitation: (prompt) => requestApproval(socket, prompt),
    });
  }

  async function dispatch(socket: Socket, message: DesktopRpcRequest): Promise<void> {
    try {
      const result = await executeRequest(socket, message);
      send(socket, {
        jsonrpc: "2.0",
        id: message.id,
        result: result === undefined ? null : result,
      });
    } catch (error) {
      if (error instanceof DesktopHelperTransportError) {
        try {
          await closeHelper();
        } catch (cleanupError) {
          options.logger.error(
            { err: cleanupError },
            "Failed to release disconnected desktop SDK host",
          );
        }
      }
      options.logger.error(
        { err: error, method: message.method },
        "Codex desktop bridge request failed",
      );
      send(socket, {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      if (activeRequest?.message === message) activeRequest = null;
    }
  }

  function handleFrame(socket: Socket, frame: Buffer): void {
    const raw: unknown = JSON.parse(frame.toString("utf8"));
    const message = DesktopMessageSchema.parse(raw);
    if ("method" in message) {
      void dispatch(socket, message);
      return;
    }
    const approval = typeof message.id === "string" ? approvals.get(message.id) : undefined;
    if (approval === undefined) {
      options.logger.debug(
        { id: message.id },
        "Desktop approval response arrived after the request ended",
      );
      return;
    }
    if (approval.socket !== socket)
      throw new Error("Desktop approval response came from another client");
    approvals.delete(String(message.id));
    clearTimeout(approval.timeout);
    if ("error" in message) approval.reject(new Error(message.error.message));
    else {
      const parsed = ApprovalSchema.safeParse(message.result);
      if (parsed.success) approval.resolve(parsed.data);
      else approval.reject(parsed.error);
    }
  }

  const server = createServer((socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        while (buffered.length >= 4) {
          const length = buffered.readUInt32LE(0);
          if (length > MAX_REQUEST_BYTES)
            throw new Error("Desktop bridge request exceeds the frame limit");
          if (buffered.length < length + 4) break;
          const frame = buffered.subarray(4, length + 4);
          buffered = buffered.subarray(length + 4);
          handleFrame(socket, frame);
        }
      } catch (error) {
        options.logger.error({ err: error }, "Invalid Codex desktop bridge frame");
        socket.destroy();
      }
    });
    socket.on("error", (error) =>
      options.logger.error({ err: error }, "Codex desktop bridge connection failed"),
    );
    socket.on("close", () => {
      sockets.delete(socket);
      rejectApprovals(socket, new Error("Desktop tool client disconnected"));
      if (helperOwner === socket) {
        void closeHelper().catch((error) =>
          options.logger.error({ err: error }, "Failed to close disconnected desktop helper"),
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.pipePath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (error) =>
    options.logger.error({ err: error }, "Codex desktop bridge server failed"),
  );
  server.unref();

  return {
    pipePath: options.pipePath,
    async endTurn(turn) {
      if (helperOwner === null || helperOwnerTurn !== `${turn.sessionId}\0${turn.turnId}`) return;
      rejectApprovals(helperOwner, new Error("Desktop tool turn ended"));
      await closeHelper();
    },
    dispose() {
      disposePromise ??= (async () => {
        disposed = true;
        const closed = new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        for (const socket of sockets) {
          rejectApprovals(socket, new Error("Desktop tools host disposed"));
          socket.destroy();
        }
        await Promise.all([closed, closeHelper()]);
      })();
      return disposePromise;
    },
  };
}
