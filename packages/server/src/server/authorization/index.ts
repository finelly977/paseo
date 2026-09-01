import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { DAEMON_PERMISSIONS, type DaemonPermission } from "@getpaseo/protocol/messages";
import {
  requiredPermissionForInbound,
  requiredPermissionForOutbound,
} from "./operation-permissions.js";

export { DAEMON_PERMISSIONS, type DaemonPermission };

const daemonPermissionSet: ReadonlySet<string> = new Set(DAEMON_PERMISSIONS);

export function isDaemonPermission(value: string): value is DaemonPermission {
  return daemonPermissionSet.has(value);
}

export function parseDaemonPermissions(values: readonly string[]): DaemonPermission[] {
  const permissions = [...new Set(values)];
  if (!permissions.every(isDaemonPermission)) throw new Error("Invalid daemon permission");
  return permissions;
}

export const OWNER_PERMISSIONS: readonly DaemonPermission[] = DAEMON_PERMISSIONS;

export class SessionAuthorization {
  private permissions: ReadonlySet<DaemonPermission>;

  constructor(permissions: readonly DaemonPermission[]) {
    this.permissions = new Set(permissions);
  }

  allowsInbound(message: SessionInboundMessage): boolean {
    return this.allows(requiredPermissionForInbound(message.type));
  }

  allowsOutbound(message: SessionOutboundMessage): boolean {
    return this.allows(requiredPermissionForOutbound(message.type));
  }

  replacePermissions(permissions: readonly DaemonPermission[]): void {
    this.permissions = new Set(permissions);
  }

  listPermissions(): DaemonPermission[] {
    return [...this.permissions];
  }

  allowsPermission(permission: DaemonPermission): boolean {
    return this.permissions.has(permission);
  }

  private allows(permission: DaemonPermission | null): boolean {
    return permission === null || this.permissions.has(permission);
  }
}

const LEGACY_HUB_EXECUTION_SCOPE = "hub.execution.*";

export function permissionsForLegacyHubScopes(
  scopes: readonly string[],
): readonly DaemonPermission[] {
  // COMPAT(semanticHubPermissions)：在 v0.7 引入；Hub 全部改用语义权限后可移除。
  if (scopes.length === 1 && scopes[0] === LEGACY_HUB_EXECUTION_SCOPE) {
    return ["hub.execute"];
  }
  throw new Error(`Unsupported legacy Hub scopes: ${scopes.join(", ")}`);
}
