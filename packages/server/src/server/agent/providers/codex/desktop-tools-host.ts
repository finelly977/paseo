import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { DesktopHelper, DesktopHelperRequestOptions } from "./desktop-tools-bridge.js";

interface HelperConstructor {
  new (options: NativeHelperOptions): DesktopHelper;
}

interface NativeHelperOptions {
  helperCommand: string;
  helperArgs: string[];
}

const [modulePath, helperPath] = z
  .tuple([z.string().min(1), z.string().min(1)])
  .parse(process.argv.slice(2));
const imported: unknown = await import(pathToFileURL(modulePath).href);
const module = z
  .object({
    WindowsHelperTransport: z.custom<HelperConstructor>((value) => typeof value === "function"),
  })
  .parse(imported);
const helper = new module.WindowsHelperTransport({
  helperCommand: helperPath,
  helperArgs: ["--parent-pid", String(process.pid)],
});
const RequestSchema = z.object({
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional(),
});
const NativeRequestSchema = z.object({
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
  codexTurnMetadata: z.unknown().optional(),
});
const ApprovalResponseSchema = z.object({
  id: z.number(),
  result: z
    .object({
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.unknown().optional(),
      _meta: z.record(z.string(), z.unknown()).nullish(),
    })
    .passthrough()
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});
type Approval = Awaited<ReturnType<DesktopHelperRequestOptions["createElicitation"]>>;
interface PendingApproval {
  resolve(approval: Approval): void;
  reject(error: Error): void;
}
const approvals = new Map<number, PendingApproval>();
let nextApprovalId = 1;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closing: Promise<void> | null = null;

function send(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeHelper(): Promise<void> {
  closing ??= (async () => {
    for (const approval of approvals.values())
      approval.reject(new Error("Desktop SDK host is closing"));
    approvals.clear();
    await helper.close();
  })();
  return closing;
}

async function dispatch(raw: unknown): Promise<void> {
  const request = RequestSchema.safeParse(raw);
  if (!request.success) {
    const response = ApprovalResponseSchema.parse(raw);
    const pending = approvals.get(response.id);
    if (pending === undefined)
      throw new Error("Desktop SDK host received an unknown approval response");
    approvals.delete(response.id);
    if (response.error) pending.reject(new Error(response.error.message));
    else if (response.result) pending.resolve(response.result);
    else pending.reject(new Error("Desktop SDK host received an empty approval response"));
    return;
  }
  const { id, method, params } = request.data;
  try {
    if (method === "ping") {
      await send({ id, result: "pong" });
      return;
    }
    if (method === "close") {
      await closeHelper();
      await send({ id, result: null });
      input.close();
      process.stdin.destroy();
      return;
    }
    if (closing !== null) throw new Error("Desktop SDK host is closing");
    if (method !== "request") throw new Error(`Unsupported desktop SDK host method: ${method}`);
    const native = NativeRequestSchema.parse(params);
    const result = await helper.request(native.method, native.params, {
      codexTurnMetadata: native.codexTurnMetadata,
      createElicitation(prompt) {
        return new Promise((resolve, reject) => {
          const approvalId = nextApprovalId++;
          approvals.set(approvalId, { resolve, reject });
          void send({ id: approvalId, method: "requestComputerUseApproval", params: prompt }).catch(
            (error) => {
              approvals.delete(approvalId);
              reject(error);
            },
          );
        });
      },
    });
    await send({ id, result: result === undefined ? null : result });
  } catch (error) {
    console.error(error);
    await send({ id, error: { message: error instanceof Error ? error.message : String(error) } });
  }
}

input.on("line", (line) => {
  void Promise.resolve()
    .then(() => dispatch(JSON.parse(line)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
      input.close();
      process.stdin.destroy();
    });
});
input.on("close", () => {
  void closeHelper().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
