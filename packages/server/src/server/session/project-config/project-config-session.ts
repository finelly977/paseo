import { realpathSync } from "node:fs";
import { resolve, sep } from "path";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry } from "../../workspace-registry.js";
import {
  readPaseoConfigForEdit,
  writePaseoConfigForEdit,
  type ProjectConfigRpcError,
} from "../../../utils/paseo-config-file.js";
import { applyProjectConfigImport, inspectProjectConfigImport } from "./import/index.js";
import { InvalidProjectConfigImportSourceError } from "./import/model.js";

export interface ProjectConfigSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ProjectConfigSessionOptions {
  host: ProjectConfigSessionHost;
  projectRegistry: Pick<ProjectRegistry, "list">;
  logger: pino.Logger;
}

/**
 * A client's read/write surface for a project's on-disk paseo.json. Resolves the
 * request's repoRoot against the known (non-archived) project roots — accepting a
 * trailing slash or a symlink via realpath — then reads or writes the config
 * substrate and emits the matching response. Reaches no state beyond the injected
 * project registry and the outbound channel.
 */
export class ProjectConfigSession {
  private readonly host: ProjectConfigSessionHost;
  private readonly projectRegistry: Pick<ProjectRegistry, "list">;
  private readonly logger: pino.Logger;

  constructor(options: ProjectConfigSessionOptions) {
    this.host = options.host;
    this.projectRegistry = options.projectRegistry;
    this.logger = options.logger;
  }

  async handleReadProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigReadFailure(msg, { code: "project_not_found" });
      return;
    }

    const result = readPaseoConfigForEdit(repoRoot);
    if (!result.ok) {
      this.logger.warn(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Failed to read project config",
      );
      this.emitProjectConfigReadFailure(msg, result.error, repoRoot);
      return;
    }

    if (result.config === null) {
      this.logger.debug(
        { repoRoot, requestId: msg.requestId, outcome: "missing_project_config" },
        "Project config missing",
      );
    }

    this.host.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
      },
    });
  }

  async handleWriteProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigWriteFailure(msg, { code: "project_not_found" });
      return;
    }

    this.logger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "write_attempt" },
      "Writing project config",
    );
    const result = writePaseoConfigForEdit({
      repoRoot,
      config: msg.config,
      expectedRevision: msg.expectedRevision,
    });
    if (!result.ok) {
      this.logger.debug(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Project config write did not complete",
      );
      this.emitProjectConfigWriteFailure(msg, result.error, repoRoot);
      return;
    }

    this.logger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "written" },
      "Project config written",
    );
    this.host.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
      },
    });
  }

  async handleGetProjectConfigImportRequest(
    msg: Extract<SessionInboundMessage, { type: "project.config.get_import.request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigImportGetFailure(msg, { code: "project_not_found" });
      return;
    }

    const config = readPaseoConfigForEdit(repoRoot);
    if (!config.ok) {
      this.emitProjectConfigImportGetFailure(msg, config.error, repoRoot);
      return;
    }

    try {
      const preview = inspectProjectConfigImport({
        repoRoot,
        source: msg.source,
        paseoConfig: config.config ?? {},
        paseoRevision: config.revision,
      });
      this.host.emit({
        type: "project.config.get_import.response",
        payload: {
          requestId: msg.requestId,
          ok: true,
          ...preview,
        },
      });
    } catch (error) {
      if (error instanceof InvalidProjectConfigImportSourceError) {
        this.emitProjectConfigImportGetFailure(
          msg,
          {
            code: "invalid_source_config",
            source: error.source,
            relativePath: error.relativePath,
          },
          repoRoot,
        );
        return;
      }
      throw error;
    }
  }

  async handleApplyProjectConfigImportRequest(
    msg: Extract<SessionInboundMessage, { type: "project.config.apply_import.request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigImportApplyFailure(msg, { code: "project_not_found" });
      return;
    }

    const result = applyProjectConfigImport({
      repoRoot,
      source: msg.source,
      expectedSourceRevision: msg.expectedSourceRevision,
      expectedPaseoRevision: msg.expectedPaseoRevision,
    });
    if (!result.ok) {
      this.emitProjectConfigImportApplyFailure(msg, result.error, repoRoot);
      return;
    }

    this.host.emit({
      type: "project.config.apply_import.response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        source: result.source,
        ok: true,
        config: result.config,
        revision: result.revision,
        items: result.items,
      },
    });
  }

  private emitProjectConfigReadFailure(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private emitProjectConfigWriteFailure(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private emitProjectConfigImportGetFailure(
    msg: Extract<SessionInboundMessage, { type: "project.config.get_import.request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "project.config.get_import.response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private emitProjectConfigImportApplyFailure(
    msg: Extract<SessionInboundMessage, { type: "project.config.apply_import.request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "project.config.apply_import.response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private async resolveKnownProjectRoot(repoRoot: string): Promise<string | null> {
    const requestedRoot = canonicalizeConfigRoot(repoRoot);
    const projects = await this.projectRegistry.list();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      const projectRoot = canonicalizeConfigRoot(project.rootPath);
      if (requestedRoot === projectRoot) {
        return projectRoot;
      }
    }
    return null;
  }
}

function canonicalizeConfigRoot(repoRoot: string): string {
  const resolved = resolve(repoRoot);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    return stripTrailingPathSeparators(resolved);
  }
}

function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
