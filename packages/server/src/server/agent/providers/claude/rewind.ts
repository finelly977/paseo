import {
  forkSession as claudeForkSession,
  tagSession as claudeTagSession,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeRewindSdk {
  forkSession(
    sessionId: string,
    options: { upToMessageId: string },
  ): Promise<{ sessionId: string }>;
  tagSession(sessionId: string, tag: string | null, options?: { dir?: string }): Promise<void>;
}

export const CLAUDE_ARCHIVED_SESSION_TAG = "archived";

export const realClaudeRewindSdk: ClaudeRewindSdk = {
  forkSession: claudeForkSession,
  tagSession: claudeTagSession,
};

export async function archiveClaudeSession(input: {
  sdk: Pick<ClaudeRewindSdk, "tagSession">;
  sessionId: string | null;
  cwd?: string;
}): Promise<void> {
  if (!input.sessionId) {
    return;
  }
  await input.sdk.tagSession(
    input.sessionId,
    CLAUDE_ARCHIVED_SESSION_TAG,
    input.cwd ? { dir: input.cwd } : undefined,
  );
}

export async function revertClaudeConversation(input: {
  sdk: ClaudeRewindSdk;
  sessionId: string | null;
  messageId: string;
  cwd?: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
  setSessionId: (sessionId: string) => void;
}): Promise<void> {
  if (!input.sessionId) {
    throw new Error("Claude session is not ready for rewind");
  }
  const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
  const fork = await input.sdk.forkSession(input.sessionId, {
    upToMessageId: messageId,
  });
  await archiveClaudeSession({
    sdk: input.sdk,
    sessionId: input.sessionId,
    cwd: input.cwd,
  });
  input.setSessionId(fork.sessionId);
}

export async function revertClaudeFiles(input: {
  query: Query;
  messageId: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
}): Promise<void> {
  const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
  const result = await input.query.rewindFiles(messageId, { dryRun: false });
  if (!result.canRewind) {
    throw new Error(result.error ?? `No file checkpoint found for message ${messageId}`);
  }
}

export async function revertClaudeConversationAndFiles(input: {
  sdk: ClaudeRewindSdk;
  query: Query;
  sessionId: string | null;
  messageId: string;
  cwd?: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
  setSessionId: (sessionId: string) => void;
}): Promise<void> {
  await revertClaudeFiles({
    query: input.query,
    messageId: input.messageId,
    resolveMessageId: input.resolveMessageId,
  });
  await revertClaudeConversation(input);
}
