import { describe, expect, it } from "vitest";
import {
  createProjectConfigImportSourceRegistry,
  projectConfigImportSourceRegistry,
  type ProjectConfigImportLogicModule,
} from ".";
import { projectConfigImportViewRegistry } from "./view";
import { createProjectConfigImportViewRegistry } from "./view-registry";

const fakeSource = {
  kind: "fake-source",
  source: { kind: "fake-source", profile: "alpha" },
  displayName: "Fake Source",
  routeValue: "fake",
} satisfies ProjectConfigImportLogicModule<{ kind: "fake-source"; profile: "alpha" }>;

describe("project config import app registry", () => {
  it("filters future advertised sources through registered logic modules", () => {
    const registry = createProjectConfigImportSourceRegistry([fakeSource]);

    expect(
      registry.advertised([
        { kind: "future-source", capability: "unknown" },
        { kind: "fake-source", profile: "alpha" },
      ]),
    ).toEqual([
      {
        kind: "fake-source",
        source: { kind: "fake-source", profile: "alpha" },
        protocolSource: null,
        module: fakeSource,
      },
    ]);
  });

  it("preserves advertised descriptors before normalizing RPC sources", () => {
    const registry = createProjectConfigImportSourceRegistry([
      {
        kind: "conductor",
        source: { kind: "conductor" },
        displayName: "Known Source",
        routeValue: "known",
      },
    ]);

    expect(registry.advertised([{ kind: "conductor", profile: "alpha" }])).toMatchObject([
      {
        kind: "conductor",
        source: { kind: "conductor", profile: "alpha" },
        protocolSource: { kind: "conductor" },
        module: { displayName: "Known Source" },
      },
    ]);
  });

  it("rejects duplicate logic kinds and route values", () => {
    expect(() => createProjectConfigImportSourceRegistry([fakeSource, fakeSource])).toThrow(
      "Duplicate project config import source: fake-source",
    );
    expect(() =>
      createProjectConfigImportSourceRegistry([
        fakeSource,
        { ...fakeSource, kind: "other-source" },
      ]),
    ).toThrow("Duplicate project config import route value: fake");
  });

  it("keeps production protocol sources registered", () => {
    expect(() => projectConfigImportSourceRegistry.assertProtocolCoverage()).not.toThrow();
  });
});

describe("project config import view registry", () => {
  const FakeIcon = () => null;

  it("rejects duplicate views and missing view modules", () => {
    expect(() =>
      createProjectConfigImportViewRegistry([
        { kind: "fake-source", Icon: FakeIcon },
        { kind: "fake-source", Icon: FakeIcon },
      ]),
    ).toThrow("Duplicate project config import view: fake-source");

    const registry = createProjectConfigImportViewRegistry([]);
    expect(() => registry.get(fakeSource.source)).toThrow(
      "Missing project config import view: fake-source",
    );
  });

  it("keeps production logic and view registries in parity", () => {
    const kinds = projectConfigImportSourceRegistry.all().map((source) => source.kind);
    expect(projectConfigImportViewRegistry.kinds()).toEqual(kinds);
  });
});
