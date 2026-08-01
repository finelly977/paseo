import type { ReactNode } from "react";

export interface SidebarProjectDropZoneProps {
  children: ReactNode;
  onDropPaths: (paths: readonly string[]) => Promise<void> | void;
  onError: (error: unknown) => void;
}

export function SidebarProjectDropZone({ children }: SidebarProjectDropZoneProps) {
  return children;
}
