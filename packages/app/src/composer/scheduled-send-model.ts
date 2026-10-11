export function parseSendDelayMinutes(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 10080 ? minutes : null;
}
