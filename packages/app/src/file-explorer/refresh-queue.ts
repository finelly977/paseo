interface ExplorerRefreshQueueInput {
  refresh: (isCurrent: () => boolean) => Promise<void>;
  onError: (error: unknown) => void;
}

export interface ExplorerRefreshQueue {
  request(): void;
  dispose(): void;
}

export function createExplorerRefreshQueue(input: ExplorerRefreshQueueInput): ExplorerRefreshQueue {
  let disposed = false;
  let pending = false;
  let inFlight: Promise<void> | null = null;

  const isCurrent = () => !disposed;
  const drain = async () => {
    while (pending) {
      if (disposed) {
        return;
      }
      pending = false;
      try {
        await input.refresh(isCurrent);
      } catch (error) {
        input.onError(error);
      }
    }
  };

  const start = () => {
    if (disposed || inFlight) {
      return;
    }
    const currentRun = drain().finally(() => {
      if (inFlight !== currentRun) {
        return;
      }
      inFlight = null;
      if (!disposed && pending) {
        start();
      }
    });
    inFlight = currentRun;
  };

  return {
    request() {
      if (disposed) {
        return;
      }
      pending = true;
      start();
    },
    dispose() {
      disposed = true;
      pending = false;
    },
  };
}
