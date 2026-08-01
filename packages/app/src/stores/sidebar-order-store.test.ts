import { describe, expect, it } from "vitest";
import { migrateSidebarOrderState } from "./sidebar-order-store";

describe("migrateSidebarOrderState", () => {
  it("prefixes legacy per-server workspace order with the source server id", () => {
    const migrated = migrateSidebarOrderState({
      projectOrderByServerId: {
        "host-a": ["project-a"],
        "host-b": ["project-a"],
      },
      workspaceOrderByServerAndProject: {
        "host-a::project-a": ["main", "feature"],
        "host-b::project-a": ["main"],
      },
    });

    expect(migrated).toEqual({
      projectAddedOrder: ["project-a"],
      projectOrder: ["project-a"],
      workspaceOrderByProject: {
        "project-a": ["host-a:main", "host-a:feature", "host-b:main"],
      },
    });
  });

  it("保留独立的加入顺序和手工顺序", () => {
    const migrated = migrateSidebarOrderState({
      projectAddedOrder: ["project-a", "project-b"],
      projectOrder: ["project-b", "project-a"],
      workspaceOrderByProject: {},
    });

    expect(migrated.projectAddedOrder).toEqual(["project-a", "project-b"]);
    expect(migrated.projectOrder).toEqual(["project-b", "project-a"]);
  });
});
