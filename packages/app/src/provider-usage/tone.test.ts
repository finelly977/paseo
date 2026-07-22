import { describe, expect, it } from "vitest";
import { resolveTone } from "./tone";

describe("provider usage tone", () => {
  it("shows the strongest risk from provider status and utilization", () => {
    expect([
      resolveTone("ok", 5),
      resolveTone("ok", 70),
      resolveTone("ok", 99),
      resolveTone("danger", 5),
    ]).toEqual(["ok", "warning", "danger", "danger"]);
  });
});
