/**
 * 用户消息默认只展示有限内容，避免粘贴大段日志或代码时挤满对话页面。
 * 触发条件和展示行数分开定义，便于保持稳定的滚动高度和可预期的交互。
 */
export const USER_MESSAGE_COLLAPSED_LINE_COUNT = 8;
export const USER_MESSAGE_COLLAPSE_LINE_THRESHOLD = 12;
export const USER_MESSAGE_COLLAPSE_CHARACTER_THRESHOLD = 1200;

export function shouldCollapseUserMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }

  const lineCount = normalized.split(/\r?\n/u).length;
  return (
    lineCount > USER_MESSAGE_COLLAPSE_LINE_THRESHOLD ||
    normalized.length > USER_MESSAGE_COLLAPSE_CHARACTER_THRESHOLD
  );
}
