import type pino from "pino";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import {
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type {
  FileDownloadTokenRequest,
  DirectorySubscribeRequest,
  DirectoryUnsubscribeRequest,
  FileExplorerRequest,
  FileUploadRequest,
  FileSubscribeRequest,
  FileUnsubscribeRequest,
  FileWriteRequest,
  SessionInboundMessage,
  SessionOutboundMessage,
} from "../../messages.js";
import { FileUploadStore } from "../../file-upload/index.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import {
  getDownloadableFileInfo,
  listDirectoryEntries,
  readExplorerFile,
  streamExplorerFile,
  writeExplorerFile,
} from "../../file-explorer/service.js";
import {
  workspaceFileObserver,
  type FileObserver as WorkspaceFileObserver,
} from "../../file-explorer/observer.js";
import {
  createFileObserver,
  type FileObserver as WorkspaceDirectoryObserver,
  type FileObserverSubscription,
} from "../../file-observer/index.js";
import { getProjectIcon } from "../../../utils/project-icon.js";

const DIRECTORY_UPDATE_DEBOUNCE_MS = 150;
const DIRECTORY_UPDATE_MAX_WAIT_MS = 1_000;

interface DirectorySubscription {
  token: object;
  subscription: FileObserverSubscription;
  cancelPendingUpdate(): void;
}

/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
  emit(msg: SessionOutboundMessage, source?: object): void;
  emitBinary(frame: Uint8Array, source?: object): Promise<void>;
  hasBinaryChannel(): boolean;
}

export interface WorkspaceFilesSessionOptions {
  host: WorkspaceFilesSessionHost;
  downloadTokenStore: DownloadTokenStore;
  paseoHome: string;
  logger: pino.Logger;
  fileObserver?: WorkspaceFileObserver;
  directoryObserver?: WorkspaceDirectoryObserver;
}

/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
  private readonly host: WorkspaceFilesSessionHost;
  private readonly downloadTokenStore: DownloadTokenStore;
  private readonly logger: pino.Logger;
  private readonly fileUploads: FileUploadStore;
  private readonly fileObserver: WorkspaceFileObserver;
  private readonly directoryObserver: WorkspaceDirectoryObserver;
  private readonly fileSubscriptions = new Map<string, () => void>();
  private readonly directorySubscriptions = new Map<string, DirectorySubscription>();

  constructor(options: WorkspaceFilesSessionOptions) {
    this.host = options.host;
    this.downloadTokenStore = options.downloadTokenStore;
    this.logger = options.logger;
    this.fileUploads = new FileUploadStore({ paseoHome: options.paseoHome });
    this.fileObserver = options.fileObserver ?? workspaceFileObserver;
    this.directoryObserver = options.directoryObserver ?? createFileObserver();
  }

  async handleFileSubscribeRequest(request: FileSubscribeRequest): Promise<void> {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    try {
      const subscription = await this.fileObserver.subscribe(
        { cwd: request.cwd, path: request.path },
        (version) => {
          this.host.emit({
            type: "fs.file.update",
            payload: { subscriptionId: request.subscriptionId, version },
          });
        },
      );
      this.fileSubscriptions.set(request.subscriptionId, subscription.unsubscribe);
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
          initial: subscription.initial,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "fs.file.subscribe.response",
        payload: {
          subscriptionId: request.subscriptionId,
          initial: {
            status: "error",
            cwd: request.cwd,
            path: request.path,
            error: getErrorMessage(error),
          },
          requestId: request.requestId,
        },
      });
    }
  }

  handleFileUnsubscribeRequest(request: FileUnsubscribeRequest): void {
    this.fileSubscriptions.get(request.subscriptionId)?.();
    this.fileSubscriptions.delete(request.subscriptionId);
    this.host.emit({
      type: "fs.file.unsubscribe.response",
      payload: { subscriptionId: request.subscriptionId, requestId: request.requestId },
    });
  }

  async handleDirectorySubscribeRequest(request: DirectorySubscribeRequest): Promise<void> {
    const cwd = request.cwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "fs.directory.subscribe.response",
        payload: {
          status: "error",
          subscriptionId: request.subscriptionId,
          error: "工作区目录不能为空",
          requestId: request.requestId,
        },
      });
      return;
    }

    const token = {};
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let updateBatchStartedAt: number | null = null;
    const cancelPendingUpdate = () => {
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
      updateBatchStartedAt = null;
    };
    const emitPendingUpdate = () => {
      updateTimer = null;
      updateBatchStartedAt = null;
      if (this.directorySubscriptions.get(request.subscriptionId)?.token !== token) return;
      this.host.emit({
        type: "fs.directory.update",
        payload: { status: "changed", subscriptionId: request.subscriptionId },
      });
    };
    const schedulePendingUpdate = () => {
      const now = Date.now();
      updateBatchStartedAt ??= now;
      if (updateTimer) clearTimeout(updateTimer);
      const remainingBatchTime = Math.max(
        0,
        DIRECTORY_UPDATE_MAX_WAIT_MS - (now - updateBatchStartedAt),
      );
      updateTimer = setTimeout(
        emitPendingUpdate,
        Math.min(DIRECTORY_UPDATE_DEBOUNCE_MS, remainingBatchTime),
      );
    };

    try {
      await this.releaseDirectorySubscription(request.subscriptionId);
      const subscription = await this.directoryObserver.subscribe(cwd, (error, events) => {
        const activeSubscription = this.directorySubscriptions.get(request.subscriptionId);
        if (activeSubscription?.token !== token) return;
        if (error) {
          cancelPendingUpdate();
          this.logger.error(
            { err: error, cwd, subscriptionId: request.subscriptionId },
            "工作区目录观察失败",
          );
          this.host.emit({
            type: "fs.directory.update",
            payload: {
              status: "error",
              subscriptionId: request.subscriptionId,
              error: getErrorMessage(error),
            },
          });
          return;
        }
        if (events.length === 0) return;
        schedulePendingUpdate();
      });
      this.directorySubscriptions.set(request.subscriptionId, {
        token,
        subscription,
        cancelPendingUpdate,
      });
      this.host.emit({
        type: "fs.directory.subscribe.response",
        payload: {
          status: "subscribed",
          subscriptionId: request.subscriptionId,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      cancelPendingUpdate();
      this.logger.error(
        { err: error, cwd, subscriptionId: request.subscriptionId },
        "订阅工作区目录失败",
      );
      this.host.emit({
        type: "fs.directory.subscribe.response",
        payload: {
          status: "error",
          subscriptionId: request.subscriptionId,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleDirectoryUnsubscribeRequest(request: DirectoryUnsubscribeRequest): Promise<void> {
    try {
      await this.releaseDirectorySubscription(request.subscriptionId);
      this.host.emit({
        type: "fs.directory.unsubscribe.response",
        payload: {
          status: "unsubscribed",
          subscriptionId: request.subscriptionId,
          requestId: request.requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, subscriptionId: request.subscriptionId },
        "取消工作区目录订阅失败",
      );
      this.host.emit({
        type: "fs.directory.unsubscribe.response",
        payload: {
          status: "error",
          subscriptionId: request.subscriptionId,
          error: getErrorMessage(error),
          requestId: request.requestId,
        },
      });
    }
  }

  async handleFileWriteRequest(request: FileWriteRequest): Promise<void> {
    const result = await writeExplorerFile({
      root: request.cwd,
      relativePath: request.path,
      content: request.content,
      expectedModifiedAt: request.expectedModifiedAt,
      expectedRevision: request.expectedRevision,
    });
    this.host.emit({
      type: "fs.file.write.response",
      payload: { result, requestId: request.requestId },
    });
  }

  async dispose(): Promise<void> {
    for (const unsubscribe of this.fileSubscriptions.values()) unsubscribe();
    this.fileSubscriptions.clear();
    for (const subscription of this.directorySubscriptions.values()) {
      subscription.cancelPendingUpdate();
    }
    this.directorySubscriptions.clear();
    await this.directoryObserver.close();
  }

  private async releaseDirectorySubscription(subscriptionId: string): Promise<void> {
    const subscription = this.directorySubscriptions.get(subscriptionId);
    if (!subscription) return;
    this.directorySubscriptions.delete(subscriptionId);
    subscription.cancelPendingUpdate();
    await subscription.subscription.unsubscribe();
  }

  async handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd: workspaceCwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: "cwd is required",
            requestId,
          },
        },
        source,
      );
      return;
    }

    try {
      if (mode === "list") {
        const directory = await listDirectoryEntries({
          root: cwd,
          relativePath: requestedPath,
        });

        this.host.emit(
          {
            type: "file_explorer_response",
            payload: {
              cwd,
              path: directory.path,
              mode,
              directory,
              file: null,
              error: null,
              requestId,
            },
          },
          source,
        );
      } else {
        if (request.maxBytes) {
          const file = await getDownloadableFileInfo({ root: cwd, relativePath: requestedPath });
          if (file.size > request.maxBytes) {
            throw new Error("文件过大，无法显示");
          }
        }
        if (request.acceptBinary && this.host.hasBinaryChannel()) {
          await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileBegin,
                requestId,
                metadata: {
                  mime: file.mimeType,
                  size: file.size,
                  encoding: file.encoding,
                  modifiedAt: file.modifiedAt,
                  revision: file.revision,
                },
              }),
              source,
            );
            for await (const chunk of file.chunks) {
              await this.host.emitBinary(
                encodeFileTransferFrame({
                  opcode: FileTransferOpcode.FileChunk,
                  requestId,
                  payload: chunk,
                }),
                source,
              );
            }
            await this.host.emitBinary(
              encodeFileTransferFrame({
                opcode: FileTransferOpcode.FileEnd,
                requestId,
              }),
              source,
            );
          });
        } else {
          const file = await readExplorerFile({
            root: cwd,
            relativePath: requestedPath,
          });

          this.host.emit(
            {
              type: "file_explorer_response",
              payload: {
                cwd,
                path: file.path,
                mode,
                directory: null,
                file,
                error: null,
                requestId,
              },
            },
            source,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to fulfill file explorer request for workspace ${cwd}`,
      );
      this.host.emit(
        {
          type: "file_explorer_response",
          payload: {
            cwd,
            path: requestedPath,
            mode,
            directory: null,
            file: null,
            error: getErrorMessage(error),
            requestId,
          },
        },
        source,
      );
    }
  }

  handleFileUploadRequest(request: FileUploadRequest): void {
    this.fileUploads.beginUpload(request);
  }

  async handleFileTransferFrame(frame: FileTransferFrame): Promise<void> {
    const response = await this.fileUploads.receiveFrame(frame);
    if (response) {
      this.host.emit(response);
    }
  }

  async handleProjectIconRequest(
    request: Extract<SessionInboundMessage, { type: "project_icon_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = request;

    try {
      const icon = await getProjectIcon(cwd);
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "project_icon_response",
        payload: {
          cwd,
          icon: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }

  async handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void> {
    const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
    const cwd = workspaceCwd.trim();
    if (!cwd) {
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd: workspaceCwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: "cwd is required",
          requestId,
        },
      });
      return;
    }

    this.logger.debug(
      { cwd, path: requestedPath },
      `Handling file download token request for workspace ${cwd} (${requestedPath})`,
    );

    try {
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });

      const entry = this.downloadTokenStore.issueToken({
        path: info.path,
        absolutePath: info.absolutePath,
        fileName: info.fileName,
        mimeType: info.mimeType,
        size: info.size,
      });

      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: info.path,
          token: entry.token,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, cwd, path: requestedPath },
        `Failed to issue download token for workspace ${cwd}`,
      );
      this.host.emit({
        type: "file_download_token_response",
        payload: {
          cwd,
          path: requestedPath,
          token: null,
          fileName: null,
          mimeType: null,
          size: null,
          error: getErrorMessage(error),
          requestId,
        },
      });
    }
  }
}
