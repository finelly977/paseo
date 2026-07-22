import type { ProviderUsageTone } from "./types";

const TONE_RISK: Record<ProviderUsageTone, number> = {
  default: 0,
  ok: 1,
  warning: 2,
  danger: 3,
};

export function deriveTone(usedPct: number | null | undefined): ProviderUsageTone {
  if (usedPct == null) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}

export function resolveTone(
  providerTone: ProviderUsageTone | undefined,
  usedPct: number | null | undefined,
): ProviderUsageTone {
  const utilizationTone = deriveTone(usedPct);
  if (!providerTone || TONE_RISK[utilizationTone] > TONE_RISK[providerTone]) {
    return utilizationTone;
  }
  return providerTone;
}
