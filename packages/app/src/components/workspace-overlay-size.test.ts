import { expect, it } from "vitest";
import { WORKSPACE_OVERLAY_FRACTION } from "./workspace-overlay-size";

it("浮层面积占视口 90%，不误用宽高各 90%", () => {
  expect(WORKSPACE_OVERLAY_FRACTION ** 2).toBeCloseTo(0.9, 12);
  expect(WORKSPACE_OVERLAY_FRACTION).toBeCloseTo(0.948683298, 9);
});
