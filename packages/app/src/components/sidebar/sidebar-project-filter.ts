/**
 * 只保留当前侧栏仍能看到的已保存项目筛选键。
 *
 * 返回空数组表示显示全部项目。主机尚未连接或主机筛选暂时隐藏目标项目时，
 * 不删除保存的键，而是让筛选暂时失效；目标项目重新可见后会自动恢复筛选。
 */
export function resolveActiveProjectFilters(
  projectFilters: readonly string[],
  availableProjectKeys: ReadonlySet<string>,
): readonly string[] {
  if (projectFilters.length === 0) return EMPTY_PROJECT_FILTERS;
  const matching = projectFilters.filter((projectKey) => availableProjectKeys.has(projectKey));
  return matching.length > 0 ? matching : EMPTY_PROJECT_FILTERS;
}

/** 根据项目允许列表筛选带有项目归属的数据。 */
export function filterItemsByProjects<Item extends { projectKey: string }>(input: {
  items: readonly Item[];
  projectFilters: readonly string[];
}): Item[] {
  if (input.projectFilters.length === 0) return [...input.items];
  const included = new Set(input.projectFilters);
  return input.items.filter((item) => included.has(item.projectKey));
}

const EMPTY_PROJECT_FILTERS: readonly string[] = [];
