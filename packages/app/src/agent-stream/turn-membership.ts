import type { StreamItem } from "@/types/stream";

/**
 * 用户消息始终开启新的展示轮次；展示轮次内的非用户消息仍以提供方的规范回合标识
 * 判断归属。
 */
export function continuesTurn(previous: StreamItem | null, next: StreamItem | null): boolean {
  if (!previous || !next) return false;
  if (next.kind === "user_message") {
    // 底层仍可把消息 steer 到提供方正在运行的原生回合，但展示层的每条用户消息都开启
    // 独立轮次，拥有自己的过程折叠和耗时。
    return false;
  }
  if (previous.turnId !== undefined && next.turnId !== undefined) {
    return previous.turnId === next.turnId;
  }
  return true;
}

export function isTurnBoundary(previous: StreamItem | null, next: StreamItem | null): boolean {
  return previous !== null && next !== null && !continuesTurn(previous, next);
}

/** Whether `item` begins a new chronological turn after `previous`. */
export function startsNewTurn(item: StreamItem, previous: StreamItem | null): boolean {
  return previous === null || isTurnBoundary(previous, item);
}

export function belongsToTurn(item: StreamItem, turnId: string | null): boolean {
  return turnId !== null && item.turnId === turnId;
}
