import { describe, expect, test } from "vitest";
import { filterItemsByProjects, resolveActiveProjectFilters } from "./sidebar-project-filter";

describe("项目筛选", () => {
  test("没有保存筛选时显示全部项目", () => {
    expect(resolveActiveProjectFilters([], new Set(["alpha", "beta"]))).toEqual([]);
  });

  test("只启用当前可见的已保存项目", () => {
    expect(resolveActiveProjectFilters(["alpha", "gone"], new Set(["alpha", "beta"]))).toEqual([
      "alpha",
    ]);
  });

  test("目标项目暂时不可见时不清空侧栏", () => {
    expect(resolveActiveProjectFilters(["alpha"], new Set(["beta"]))).toEqual([]);
    expect(resolveActiveProjectFilters(["alpha"], new Set())).toEqual([]);
  });

  test("按项目允许列表筛选工作区", () => {
    const items = [
      { id: "one", projectKey: "alpha" },
      { id: "two", projectKey: "alpha" },
      { id: "three", projectKey: "beta" },
    ];
    expect(filterItemsByProjects({ items, projectFilters: ["alpha"] })).toEqual(items.slice(0, 2));
    expect(filterItemsByProjects({ items, projectFilters: [] })).toEqual(items);
  });
});
