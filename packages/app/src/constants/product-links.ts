const REPOSITORY_URL = "https://github.com/finelly977/paseo";
const PUBLIC_DOCS_URL = `${REPOSITORY_URL}/blob/main/public-docs`;

export const PASEO_LINKS = {
  repository: REPOSITORY_URL,
  issues: `${REPOSITORY_URL}/issues/new`,
  releases: `${REPOSITORY_URL}/releases`,
  releaseDownloads: `${REPOSITORY_URL}/releases/download`,
  docs: `${REPOSITORY_URL}/tree/main/public-docs`,
  configuration: `${PUBLIC_DOCS_URL}/configuration.md`,
  cli: `${PUBLIC_DOCS_URL}/cli.md`,
  skills: `${PUBLIC_DOCS_URL}/skills.md`,
  worktrees: `${PUBLIC_DOCS_URL}/worktrees.md`,
  schedules: `${PUBLIC_DOCS_URL}/schedules.md`,
} as const;
