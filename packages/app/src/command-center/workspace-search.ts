import {
  compareCommandCenterScores,
  filterAndRankBuiltInResults,
  scoreSearchFields,
  type CommandCenterScore,
  type CommandCenterWorkspaceResult,
} from "./results";

/** 变更请求查询：可选的 `pr`/`mr`、可选的 `#`/`!`，以及一个正整数。 */
const CHANGE_REQUEST_QUERY = /^(?:(?:pr|mr)\s*)?[#!]?(\d+)$/i;

/**
 * 从只包含变更请求标识的查询中解析编号。
 *
 * 接受 `42`、`#42`、`!42`、`pr 42`、`pr42`、`PR #42`、`mr!42` 等写法。
 * 仅仅包含数字的普通文本（例如 `fix-42-retries`）不走编号匹配，继续使用文本搜索。
 */
function parseChangeRequestQuery(query: string): number | null {
  const match = CHANGE_REQUEST_QUERY.exec(query.trim());
  if (!match) return null;
  const digits = match[1];
  if (digits === undefined) {
    throw new Error("Change-request query regex matched without its numeric capture");
  }
  const number = Number.parseInt(digits, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

interface ScoredWorkspace {
  workspace: CommandCenterWorkspaceResult;
  score: CommandCenterScore | null;
  changeRequestHit: boolean;
}

function searchFields(workspace: CommandCenterWorkspaceResult) {
  return { visible: [workspace.title, workspace.subtitle], hidden: [] };
}

function compareScoredWorkspaces(
  left: ScoredWorkspace,
  right: ScoredWorkspace,
  tiebreak: (left: CommandCenterWorkspaceResult, right: CommandCenterWorkspaceResult) => number,
): number {
  if (left.changeRequestHit !== right.changeRequestHit) {
    return left.changeRequestHit ? -1 : 1;
  }
  if (left.score && right.score) {
    const scoreDelta = compareCommandCenterScores(left.score, right.score);
    if (scoreDelta !== 0) return scoreDelta;
  }
  return tiebreak(left.workspace, right.workspace);
}

export function filterAndRankWorkspaces(
  workspaces: readonly CommandCenterWorkspaceResult[],
  query: string,
  tiebreak: (left: CommandCenterWorkspaceResult, right: CommandCenterWorkspaceResult) => number,
): CommandCenterWorkspaceResult[] {
  if (!query.trim()) {
    return filterAndRankBuiltInResults(workspaces, query, searchFields, tiebreak);
  }

  const changeRequestNumber = parseChangeRequestQuery(query);
  const matches: ScoredWorkspace[] = [];
  for (const workspace of workspaces) {
    const score = scoreSearchFields(query, searchFields(workspace));
    const changeRequestHit =
      changeRequestNumber !== null && workspace.changeRequestNumber === changeRequestNumber;
    if (score || changeRequestHit) matches.push({ workspace, score, changeRequestHit });
  }
  matches.sort((left, right) => compareScoredWorkspaces(left, right, tiebreak));
  return matches.map((match) => match.workspace);
}
