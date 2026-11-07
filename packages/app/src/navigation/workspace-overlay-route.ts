/** 这些全局浮层保留工作区作背景，但不取得工作区焦点。 */
export function isWorkspaceOverlayRoute(pathname: string): boolean {
  return pathname.startsWith("/settings") || pathname === "/codex-plugins";
}
