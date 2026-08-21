import { scorePathMatch } from "@getpaseo/protocol/search/path-match";

export interface BuildWorkingDirectorySuggestionsInput {
  recommendedPaths: string[];
  serverPaths: string[];
  query: string;
}

export function buildWorkingDirectorySuggestions(
  input: BuildWorkingDirectorySuggestionsInput,
): string[] {
  const query = input.query.trim();
  const recommended = uniquePaths(input.recommendedPaths);
  if (!query) {
    return recommended;
  }

  const matchingRecommended = recommended.filter((path) =>
    recommendedPathMatchesQuery(path, query),
  );

  // 守护进程已经排好服务端结果；推荐路径使用同一匹配规则，但保留原有推荐顺序。
  return uniquePaths([...matchingRecommended, ...input.serverPaths]);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function recommendedPathMatchesQuery(path: string, query: string): boolean {
  const candidate = normalizePath(path);
  const normalizedQuery = normalizePath(query);
  if (["~", "~/"].includes(normalizedQuery)) {
    return true;
  }

  return scorePathMatch(normalizedQuery, candidate) !== null;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}
