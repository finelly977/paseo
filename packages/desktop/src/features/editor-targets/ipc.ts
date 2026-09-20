import { ipcMain } from "electron";
import { z } from "zod";

import { listAvailableEditorTargets, openEditorTarget } from "./registry.js";
import { createEditorTargetRuntime } from "./runtime.js";
import type { EditorTarget, EditorTargetRuntime } from "./target.js";
import { assertTrustedIpcSender } from "../../security/trusted-renderer.js";

interface IpcHandlerRegistry {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

const EditorTargetLaunchInputSchema = z.object({
  editorId: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  filePath: z.string().trim().min(1).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

export function registerEditorTargetHandlers(
  options: {
    ipc?: IpcHandlerRegistry;
    runtime?: EditorTargetRuntime;
    targets?: readonly EditorTarget[];
  } = {},
): void {
  const ipc = options.ipc ?? ipcMain;
  const runtime = options.runtime ?? createEditorTargetRuntime();

  ipc.handle("paseo:editor:listTargets", (event) => {
    assertTrustedIpcSender(event as Electron.IpcMainInvokeEvent);
    return listAvailableEditorTargets(runtime, options.targets);
  });
  ipc.handle("paseo:editor:openTarget", async (event, payload: unknown) => {
    assertTrustedIpcSender(event as Electron.IpcMainInvokeEvent);
    const input = EditorTargetLaunchInputSchema.parse(payload);
    await openEditorTarget(input, runtime, options.targets);
  });
}
