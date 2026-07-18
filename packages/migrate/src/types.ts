import type { PaseoConfigRaw, PaseoConfigRevision } from "@getpaseo/protocol/messages";

export type MigrationNoticeLevel = "info" | "warning" | "error";

export interface MigrationNotice {
  code: string;
  level: MigrationNoticeLevel;
  message: string;
}

export interface MigrationWorkspace {
  sourceId: string;
  state: string;
  path: string | null;
  branch: string | null;
  archiveCommit: string | null;
  directoryName: string;
  disposition:
    | "adopt"
    | "create"
    | "recoverable-from-commit"
    | "missing-ref"
    | "archived"
    | "invalid";
  notices: MigrationNotice[];
}

export interface MigrationProject {
  sourceId: string;
  rootPath: string;
  config: PaseoConfigRaw | null;
  workspaces: MigrationWorkspace[];
  notices: MigrationNotice[];
}

export interface MigrationInventory {
  projects: MigrationProject[];
  skippedSettings: MigrationNotice[];
}

export interface MigrationSource {
  id: string;
  inspect(): Promise<MigrationInventory>;
}

export interface PaseoMigrationPort {
  addProject(rootPath: string): Promise<void>;
  openCheckout(path: string): Promise<void>;
  readProjectConfig(rootPath: string): Promise<{
    config: PaseoConfigRaw | null;
    revision: PaseoConfigRevision | null;
  }>;
  writeProjectConfig(input: {
    rootPath: string;
    config: PaseoConfigRaw;
    expectedRevision: PaseoConfigRevision | null;
  }): Promise<void>;
  ensureCheckout(input: {
    rootPath: string;
    refName: string;
    directoryName: string;
  }): Promise<{ path: string; created: boolean }>;
}

export interface MigrationEvent {
  level: MigrationNoticeLevel;
  message: string;
}

export type MigrationOutput = (event: MigrationEvent) => void;
