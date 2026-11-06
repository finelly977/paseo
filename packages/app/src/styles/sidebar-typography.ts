// 工作区列表比正文小一级，字号设置变更时保持这层关系。
export const SIDEBAR_FONT_SIZE_OFFSET = 1;
export const SIDEBAR_TYPOGRAPHY_DATASET = { psidebar: "" } as const;

export function resolveSidebarFontSize(uiFontSize: number): number {
  return uiFontSize - SIDEBAR_FONT_SIZE_OFFSET;
}
