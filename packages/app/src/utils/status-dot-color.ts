import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export function isEmphasizedStatusDotBucket(
  bucket: SidebarStateBucket | null | undefined,
): boolean {
  return bucket === "needs_input" || bucket === "attention";
}
