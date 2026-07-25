const CODEX_GIT_DIRECTIVE_PATTERN =
  /^\s*::git-(?:stage|commit|push|create-branch|create-pr)\{.*\}\s*$/;
const MARKDOWN_FENCE_PATTERN = /^\s*(?:```|~~~)/;

export function stripCodexGitDirectives(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const visibleLines: string[] = [];
  let insideFence = false;

  for (const line of lines) {
    if (MARKDOWN_FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
      visibleLines.push(line);
      continue;
    }
    if (!insideFence && CODEX_GIT_DIRECTIVE_PATTERN.test(line)) {
      continue;
    }
    visibleLines.push(line);
  }

  return visibleLines.join("\n");
}
