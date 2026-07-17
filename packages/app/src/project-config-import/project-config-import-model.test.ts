import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  ProjectConfigImportSourceSchema,
  type ProjectConfigImportPreview,
  type ProjectConfigImportSource,
} from "@getpaseo/protocol/messages";
import { fetchQueryOptions } from "@/data/query";
import {
  projectConfigImportPreviewQueryInput,
  projectConfigImportPreviewQueryKey,
  projectConfigImportPreviewQueryRoot,
  stableProjectConfigImportSourceKey,
} from "./preview-cache";
import {
  createProjectConfigImportIntentFromRegistration,
  parseProjectConfigImportIntent,
  stripProjectConfigImportSearchParams,
} from "./route";
import { projectConfigImportApplyFailureRetryAction } from "./retry";
import { projectConfigImportAvailabilityStatus } from "./availability";
import {
  createProjectConfigImportSourceRegistry,
  type ProjectConfigImportSourceDescriptor,
} from "./sources";

interface FakeImportSource extends ProjectConfigImportSourceDescriptor {
  kind: "fake-source";
  profile: "alpha";
}
const fakeSource: FakeImportSource = { kind: "fake-source", profile: "alpha" };
const protocolSource: ProjectConfigImportSource = ProjectConfigImportSourceSchema.options[0].parse({
  kind: ProjectConfigImportSourceSchema.options[0].shape.kind.value,
});

const registry = createProjectConfigImportSourceRegistry([
  {
    kind: fakeSource.kind,
    source: fakeSource,
    displayName: "Test Source",
    routeValue: "test-source",
  },
]);

function parseFakeSource(source: ProjectConfigImportSourceDescriptor): FakeImportSource | null {
  return source.kind === fakeSource.kind ? fakeSource : null;
}

describe("project config import intent", () => {
  it("parses a host-bound route intent through the source registry", () => {
    expect(
      parseProjectConfigImportIntent(
        {
          importSource: "test-source",
          importServerId: "server-1",
          importIntentId: "intent-1",
        },
        registry,
        parseFakeSource,
      ),
    ).toEqual({
      serverId: "server-1",
      source: fakeSource,
      protocolSource: fakeSource,
      intentId: "intent-1",
    });
  });

  it("rejects missing or unknown sources", () => {
    expect(
      parseProjectConfigImportIntent(
        {
          importSource: "other",
          importServerId: "server-1",
          importIntentId: "intent-1",
        },
        registry,
        parseFakeSource,
      ),
    ).toBeNull();
    expect(
      parseProjectConfigImportIntent({ importSource: "test-source" }, registry, parseFakeSource),
    ).toBeNull();
  });

  it("uses the supplied registry instead of a hardcoded route map", () => {
    const alternateRegistry = createProjectConfigImportSourceRegistry([
      {
        kind: fakeSource.kind,
        source: fakeSource,
        displayName: "Fake Second",
        routeValue: "fake",
      },
    ]);

    expect(
      parseProjectConfigImportIntent(
        {
          importSource: "fake",
          importServerId: "server-1",
          importIntentId: "intent-1",
        },
        alternateRegistry,
        parseFakeSource,
      ),
    ).toEqual({
      serverId: "server-1",
      source: fakeSource,
      protocolSource: fakeSource,
      intentId: "intent-1",
    });
  });

  it("strips consumed import params from browser routes", () => {
    expect(
      stripProjectConfigImportSearchParams(
        "/settings/projects/repo?keep=yes&importSource=conductor&importServerId=host&importIntentId=1#section",
      ),
    ).toBe("/settings/projects/repo?keep=yes#section");
  });
});

describe("project config import retries", () => {
  it("refreshes the preview when the source disappears during apply", () => {
    expect(
      projectConfigImportApplyFailureRetryAction({
        code: "source_config_not_found",
        source: protocolSource,
      }),
    ).toBe("refresh");
  });

  it("refreshes the preview after an apply-time source parse failure", () => {
    expect(
      projectConfigImportApplyFailureRetryAction({
        code: "invalid_source_config",
        source: protocolSource,
        relativePath: ".conductor/settings.toml",
      }),
    ).toBe("refresh");
  });
});

describe("project config import preview cache keys", () => {
  it("groups source previews under a repository cache root", () => {
    expect(projectConfigImportPreviewQueryKey("server", "/repo", fakeSource)).toEqual([
      ...projectConfigImportPreviewQueryRoot("server", "/repo"),
      stableProjectConfigImportSourceKey(fakeSource),
    ]);
  });

  it("uses the full source descriptor instead of kind alone", () => {
    const alpha = { kind: "variant-source", profile: "alpha" };
    const beta = { profile: "beta", kind: "variant-source" };

    expect(projectConfigImportPreviewQueryKey("server", "/repo", alpha)).not.toEqual(
      projectConfigImportPreviewQueryKey("server", "/repo", beta),
    );
  });

  it("serializes source descriptors deterministically", () => {
    expect(stableProjectConfigImportSourceKey({ profile: "alpha", kind: "variant-source" })).toBe(
      stableProjectConfigImportSourceKey({ kind: "variant-source", profile: "alpha" }),
    );
  });

  it("does not refetch a current availability preview when the sheet opens", async () => {
    const calls: string[] = [];
    const rpcSources: ProjectConfigImportSource[] = [];
    const client = {
      getProjectConfigImport: async (input: {
        source: ProjectConfigImportSource;
      }): Promise<ProjectConfigImportPreview & { ok: true; requestId: string }> => {
        calls.push("preview");
        rpcSources.push(input.source);
        return {
          ok: true,
          requestId: "preview-1",
          repoRoot: "/repo",
          source: protocolSource,
          status: "available",
          sourceRevision: "source-1",
          paseoRevision: null,
          inputs: [],
          items: [],
          preview: {},
        };
      },
    };
    const queryClient = new QueryClient();
    const input = projectConfigImportPreviewQueryInput({
      client,
      serverId: "server",
      repoRoot: "/repo",
      source: { ...protocolSource, profile: "alpha" },
      protocolSource,
      enabled: true,
    });

    const options = fetchQueryOptions(input);
    await queryClient.fetchQuery(options);
    const observer = new QueryObserver(queryClient, queryClient.defaultQueryOptions(options));
    const unsubscribe = observer.subscribe(() => {});
    observer.getOptimisticResult(queryClient.defaultQueryOptions(options));
    unsubscribe();

    expect(calls).toEqual(["preview"]);
    expect(rpcSources).toEqual([protocolSource]);
    expect(input.queryKey).toEqual(
      projectConfigImportPreviewQueryKey("server", "/repo", {
        ...protocolSource,
        profile: "alpha",
      }),
    );
  });

  it("keeps advertised identity separate from the protocol source after opening", async () => {
    const sameKindRegistry = createProjectConfigImportSourceRegistry([
      {
        kind: protocolSource.kind,
        source: protocolSource,
        displayName: "Protocol Source",
        routeValue: "protocol-source",
      },
    ]);
    const [alphaRegistration, betaRegistration] = sameKindRegistry.advertised([
      { kind: protocolSource.kind, profile: "alpha" },
      { kind: protocolSource.kind, profile: "beta" },
    ]);
    const alphaIntent = alphaRegistration
      ? createProjectConfigImportIntentFromRegistration({
          serverId: "server",
          registration: alphaRegistration,
          intentId: "alpha",
        })
      : null;
    const betaIntent = betaRegistration
      ? createProjectConfigImportIntentFromRegistration({
          serverId: "server",
          registration: betaRegistration,
          intentId: "beta",
        })
      : null;
    const calls: ProjectConfigImportSource[] = [];
    const client = {
      getProjectConfigImport: async (input: {
        source: ProjectConfigImportSource;
      }): Promise<ProjectConfigImportPreview & { ok: true; requestId: string }> => {
        calls.push(input.source);
        return {
          ok: true,
          requestId: `preview-${calls.length}`,
          repoRoot: "/repo",
          source: input.source,
          status: "available",
          sourceRevision: `source-${calls.length}`,
          paseoRevision: null,
          inputs: [],
          items: [],
          preview: {},
        };
      },
    };
    const queryClient = new QueryClient();

    expect(alphaIntent?.source).toEqual({ kind: protocolSource.kind, profile: "alpha" });
    expect(betaIntent?.source).toEqual({ kind: protocolSource.kind, profile: "beta" });
    expect(alphaIntent?.protocolSource).toEqual(protocolSource);
    expect(betaIntent?.protocolSource).toEqual(protocolSource);

    const alphaInput = projectConfigImportPreviewQueryInput({
      client,
      serverId: "server",
      repoRoot: "/repo",
      source: alphaIntent?.source ?? null,
      protocolSource: alphaIntent?.protocolSource ?? null,
      enabled: true,
    });
    const betaInput = projectConfigImportPreviewQueryInput({
      client,
      serverId: "server",
      repoRoot: "/repo",
      source: betaIntent?.source ?? null,
      protocolSource: betaIntent?.protocolSource ?? null,
      enabled: true,
    });

    expect(alphaInput.queryKey).not.toEqual(betaInput.queryKey);
    await queryClient.fetchQuery(fetchQueryOptions(alphaInput));
    await queryClient.fetchQuery(fetchQueryOptions(betaInput));
    expect(calls).toEqual([protocolSource, protocolSource]);
  });
});

describe("project config import availability", () => {
  it("waits for advertised source previews before reporting no imports", () => {
    expect(projectConfigImportAvailabilityStatus({ availableCount: 0, isLoading: true })).toBe(
      "loading",
    );
    expect(projectConfigImportAvailabilityStatus({ availableCount: 0, isLoading: false })).toBe(
      "none",
    );
  });
});
