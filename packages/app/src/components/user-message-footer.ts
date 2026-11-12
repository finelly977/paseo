/** 触控端直接提供消息操作，但不把悬停时的辅助时间变成常驻信息。 */
export function resolveUserMessageFooterVisibility(input: {
  hasText: boolean;
  touchLayout: boolean;
  hovered: boolean;
}) {
  return {
    actions: input.hasText && (input.touchLayout || input.hovered),
    timestamp: input.hasText && !input.touchLayout && input.hovered,
  };
}
