export type ProjectConfigImportAvailabilityStatus = "loading" | "none" | "one" | "many";

export function projectConfigImportAvailabilityStatus(input: {
  availableCount: number;
  isLoading: boolean;
}): ProjectConfigImportAvailabilityStatus {
  if (input.isLoading) {
    return "loading";
  }
  if (input.availableCount === 0) {
    return "none";
  }
  return input.availableCount === 1 ? "one" : "many";
}
