import type { CheckoutPrStatusPayload } from "@/git/pr-status";

interface PullRequestStatusRefreshResult {
  data?: CheckoutPrStatusPayload;
  error: Error | null;
}

export async function openOrCreatePullRequest(input: {
  refetch: () => Promise<PullRequestStatusRefreshResult>;
  open: (url: string) => void;
  create: () => void;
}): Promise<void> {
  const result = await input.refetch();
  if (result.error) {
    throw result.error;
  }
  if (result.data?.error) {
    throw new Error(result.data.error.message);
  }
  const url = result.data?.status?.url;
  if (url) {
    input.open(url);
    return;
  }
  input.create();
}
