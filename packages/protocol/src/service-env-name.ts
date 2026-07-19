export function normalizeServiceEnvName(scriptName: string): string {
  return scriptName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
