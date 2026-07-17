import { describe, expect, test } from "vitest";
import {
  createProjectConfigImportRegistry,
  productionProjectConfigImportSourceSet,
  projectConfigImportRegistry,
  type ProjectConfigImportAdapter,
  type ProjectConfigImportSourceSet,
} from "./registry.js";

interface FakeSource {
  kind: "fake-source";
  profile: string;
}

const fakeSourceSet = {
  parse: (source) =>
    source.kind === "fake-source" && typeof source.profile === "string"
      ? { kind: "fake-source", profile: source.profile }
      : null,
  kinds: () => ["fake-source"],
} satisfies ProjectConfigImportSourceSet<FakeSource>;

const fakeAdapter = {
  source: { kind: "fake-source", profile: "alpha" },
  inspect: () => null,
} satisfies ProjectConfigImportAdapter<FakeSource>;

describe("project config import adapter registry", () => {
  test("enumerates every advertised source from registered adapters", () => {
    const productionSource = productionProjectConfigImportSourceSet.parse({
      kind: productionProjectConfigImportSourceSet.kinds()[0],
    })!;

    expect(projectConfigImportRegistry.sources()).toEqual([productionSource]);
    expect(projectConfigImportRegistry.get(productionSource.kind)).toBeTruthy();
    expect(() => projectConfigImportRegistry.assertProtocolCoverage()).not.toThrow();
  });

  test("rejects duplicate adapters before coordinators run", () => {
    expect(() =>
      createProjectConfigImportRegistry([fakeAdapter, fakeAdapter], fakeSourceSet),
    ).toThrow("Duplicate project config import adapter: fake-source");
  });

  test("rejects adapter kinds outside the protocol source union", () => {
    expect(() =>
      createProjectConfigImportRegistry(
        [
          {
            source: { kind: "not-in-protocol" },
            inspect: () => null,
          },
        ],
        productionProjectConfigImportSourceSet,
      ),
    ).toThrow("Unknown project config import adapter: not-in-protocol");
  });

  test("accepts explicit test source sets without protocol casts", () => {
    const registry = createProjectConfigImportRegistry([fakeAdapter], fakeSourceSet);

    expect(registry.sources()).toEqual([{ kind: "fake-source", profile: "alpha" }]);
    expect(registry.get("fake-source")).toBe(fakeAdapter);
    expect(() => registry.assertProtocolCoverage()).not.toThrow();
  });

  test("validates full adapter source descriptors", () => {
    expect(() =>
      createProjectConfigImportRegistry(
        [
          {
            source: { kind: "fake-source" },
            inspect: () => null,
          },
        ],
        fakeSourceSet,
      ),
    ).toThrow("Unknown project config import adapter: fake-source");
  });
});
