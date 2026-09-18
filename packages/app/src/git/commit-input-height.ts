export const COMMIT_INPUT_MIN_HEIGHT = 26;
export const COMMIT_INPUT_MAX_HEIGHT = 100;

export function resolveCommitInputHeightFromContent(
  contentHeight: number,
  message: string,
): number {
  if (message.length === 0) {
    return COMMIT_INPUT_MIN_HEIGHT;
  }
  return Math.max(
    COMMIT_INPUT_MIN_HEIGHT,
    Math.min(COMMIT_INPUT_MAX_HEIGHT, Math.ceil(contentHeight)),
  );
}
