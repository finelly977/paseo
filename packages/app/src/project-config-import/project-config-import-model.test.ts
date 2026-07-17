import { describe, expect, it } from "vitest";
import {
  normalizeProjectConfigImportError,
  openProjectConfigImport,
  parseProjectConfigImportIntent,
  projectConfigImportApplyFailureRetryAction,
  projectConfigImportCanApply,
  projectConfigImportNeedsRefresh,
  projectConfigImportSourceFeature,
} from "./project-config-import-model";

describe("project config import intent", () => {
  it("parses a Conductor host-bound route intent", () => {
    expect(
      parseProjectConfigImportIntent({
        importSource: "conductor",
        importServerId: "server-1",
        importIntentId: "intent-1",
      }),
    ).toEqual({
      serverId: "server-1",
      source: { kind: "conductor" },
      intentId: "intent-1",
    });
  });

  it("rejects missing or unknown sources", () => {
    expect(
      parseProjectConfigImportIntent({
        importSource: "other",
        importServerId: "server-1",
        importIntentId: "intent-1",
      }),
    ).toBeNull();
    expect(parseProjectConfigImportIntent({ importSource: "conductor" })).toBeNull();
  });

  it("maps Conductor to its source-specific feature flag", () => {
    expect(projectConfigImportSourceFeature({ kind: "conductor" })).toBe(
      "projectConfigImportConductor",
    );
  });
});

describe("project config import state model", () => {
  const intent = {
    serverId: "server-1",
    source: { kind: "conductor" as const },
    intentId: "intent-1",
  };
  const preview = {
    requestId: "preview-1",
    repoRoot: "/repo/app",
    source: { kind: "conductor" as const },
    ok: true as const,
    status: "available" as const,
    sourceRevision: "source-1",
    paseoRevision: null,
    inputs: [],
    items: [],
    preview: { worktree: { setup: "npm ci" } },
  };

  it("projects loading, ready, applying, and error states", () => {
    expect(
      openProjectConfigImport({
        intent,
        preview: null,
        isLoading: true,
        error: null,
        isApplying: false,
      }),
    ).toEqual({ status: "loading", intent, preview: null, error: null });

    const ready = openProjectConfigImport({
      intent,
      preview,
      isLoading: false,
      error: null,
      isApplying: false,
    });
    expect(ready).toEqual({ status: "ready", intent, preview, error: null });
    expect(projectConfigImportCanApply(ready)).toBe(true);

    expect(
      openProjectConfigImport({
        intent,
        preview,
        isLoading: false,
        error: null,
        isApplying: true,
      }),
    ).toEqual({ status: "applying", intent, preview, error: null });

    expect(
      openProjectConfigImport({
        intent,
        preview,
        isLoading: false,
        error: { code: "stale_source_config", source: { kind: "conductor" } },
        isApplying: false,
      }),
    ).toEqual({
      status: "error",
      intent,
      preview,
      error: { code: "stale_source_config", source: { kind: "conductor" } },
      retryAction: "refresh",
    });
  });

  it("normalizes transport errors and identifies refresh-required domain errors", () => {
    expect(normalizeProjectConfigImportError(new Error("socket closed"))).toEqual({
      code: "transport",
      message: "socket closed",
    });
    expect(
      projectConfigImportNeedsRefresh({
        code: "stale_project_config",
        currentRevision: null,
      }),
    ).toBe(true);
    expect(projectConfigImportNeedsRefresh({ code: "nothing_to_import" })).toBe(true);
    expect(projectConfigImportNeedsRefresh({ code: "write_failed" })).toBe(false);
    expect(projectConfigImportApplyFailureRetryAction({ code: "write_failed" })).toBe("apply");
    expect(projectConfigImportApplyFailureRetryAction({ code: "nothing_to_import" })).toBe(
      "refresh",
    );
    expect(
      projectConfigImportApplyFailureRetryAction({
        code: "stale_source_config",
        source: { kind: "conductor" },
      }),
    ).toBe("refresh");
  });
});
