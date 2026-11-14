import os from "node:os";
import { describe, expect, test } from "vitest";
import { DaemonClient } from "../../../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../../../test-utils/paseo-daemon.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexAppServerAgentClient } from "../codex-app-server-agent.js";
import { CodexAppServerClient } from "./app-server-transport.js";
import { resolveCodexForkTurnId } from "./fork.js";
import { createFakeCodexAppServer } from "./test-utils/fake-app-server.js";

describe("Codex native fork", () => {
  test("resolves native turn id on paginated threads via turns and items", async () => {
    const appServer = createFakeCodexAppServer({
      "thread/read": () => ({
        thread: { id: "thread-1", historyMode: "paginated" },
      }),
      "thread/turns/list": () => ({
        data: [{ id: "native-turn-2" }, { id: "native-turn-1" }],
        nextCursor: null,
      }),
      "thread/items/list": () => ({
        data: [
          {
            turnId: "native-turn-2",
            item: { id: "msg-2", type: "agentMessage", text: "second" },
          },
          {
            turnId: "native-turn-1",
            item: { id: "msg-1", clientId: "client-1", type: "userMessage", content: [] },
          },
        ],
        nextCursor: null,
      }),
    });
    const client = new CodexAppServerClient(appServer.child, createTestLogger());

    await expect(
      resolveCodexForkTurnId({
        client,
        threadId: "thread-1",
        nativeTurnId: "native-turn-1",
      }),
    ).resolves.toBe("native-turn-1");

    await expect(
      resolveCodexForkTurnId({
        client,
        threadId: "thread-1",
        nativeTurnId: "paseo-synthetic-turn",
        messageIds: ["msg-2"],
        turnIndex: 1,
      }),
    ).resolves.toBe("native-turn-2");

    await client.dispose();
  });

  test("forks a Codex session via thread/fork and imports the new thread", async () => {
    const recordedForks: unknown[] = [];
    const appServer = createFakeCodexAppServer({
      "thread/read": (params) => {
        const record = params as { threadId?: string };
        if (record.threadId === "forked-thread") {
          return {
            thread: {
              id: "forked-thread",
              historyMode: "legacy",
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  items: [
                    {
                      id: "u1",
                      type: "userMessage",
                      content: [{ type: "text", text: "第一问" }],
                    },
                    {
                      id: "a1",
                      type: "agentMessage",
                      text: "第一答",
                    },
                  ],
                },
              ],
            },
          };
        }
        return {
          thread: {
            id: "source-thread",
            historyMode: "legacy",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [{ id: "a1", type: "agentMessage", text: "第一答" }],
              },
              {
                id: "turn-2",
                status: "completed",
                items: [{ id: "a2", type: "agentMessage", text: "第二答" }],
              },
            ],
          },
        };
      },
      "thread/fork": (params) => {
        recordedForks.push(params);
        return {
          thread: {
            id: "forked-thread",
            sessionId: "forked-session",
            forkedFromId: "source-thread",
            turns: [],
          },
          model: "gpt-5.4",
          modelProvider: "openai",
          serviceTier: null,
          cwd: "/workspace/new",
          runtimeWorkspaceRoots: [],
          instructionSources: [],
          approvalPolicy: "on-request",
          approvalsReviewer: null,
          sandbox: { type: "workspaceWrite", networkAccess: false },
          activePermissionProfile: null,
          reasoningEffort: "medium",
        };
      },
      "thread/resume": (params) => ({
        thread: {
          id: (params as { threadId?: string }).threadId ?? "forked-thread",
          historyMode: "legacy",
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [
                {
                  id: "u1",
                  type: "userMessage",
                  content: [{ type: "text", text: "第一问" }],
                },
                {
                  id: "a1",
                  type: "agentMessage",
                  text: "第一答",
                },
              ],
            },
          ],
        },
        model: "gpt-5.4",
        serviceTier: null,
        reasoningEffort: "medium",
      }),
    });

    const provider = new CodexAppServerAgentClient(createTestLogger());
    (provider as unknown as { spawnAppServer: () => Promise<unknown> }).spawnAppServer = () =>
      appServer.spawnChild();

    const forked = await provider.forkSession(
      {
        persistence: {
          provider: "codex",
          sessionId: "source-thread",
          nativeHandle: "source-thread",
        },
        sourceConfig: { provider: "codex", cwd: "/workspace/old", model: "gpt-5.4" },
        cwd: "/workspace/new",
        nativeTurnId: "turn-1",
        title: "分支会话",
      },
      {
        config: { provider: "codex", cwd: "/workspace/new", model: "gpt-5.4" },
        storedConfig: { provider: "codex", cwd: "/workspace/new", model: "gpt-5.4" },
      },
    );

    expect(recordedForks).toMatchObject([
      {
        threadId: "source-thread",
        lastTurnId: "turn-1",
        cwd: "/workspace/new",
        model: "gpt-5.4",
        excludeTurns: true,
      },
    ]);
    expect(forked.persistence.sessionId).toBe("forked-thread");
    expect(forked.timeline.map((entry) => entry.item.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);
    await forked.session.close();
  });

  test("handles agent.fork.request RPC through daemon", async () => {
    const appServer = createFakeCodexAppServer({
      "thread/read": (params) => {
        const record = params as { threadId?: string };
        return {
          thread: {
            id: record.threadId ?? "thread-1",
            historyMode: "legacy",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  { id: "u1", type: "userMessage", content: [{ type: "text", text: "你好" }] },
                  { id: "a1", type: "agentMessage", text: "你好！" },
                ],
              },
            ],
          },
        };
      },
      "thread/resume": () => ({
        thread: {
          id: "forked-thread",
          historyMode: "legacy",
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [
                { id: "u1", type: "userMessage", content: [{ type: "text", text: "你好" }] },
                { id: "a1", type: "agentMessage", text: "你好！" },
              ],
            },
          ],
        },
        model: "gpt-5.4",
      }),
    });
    const codexClient = new CodexAppServerAgentClient(createTestLogger());
    (codexClient as unknown as { spawnAppServer: () => Promise<unknown> }).spawnAppServer = () =>
      appServer.spawnChild();

    const daemon = await createTestPaseoDaemon({
      agentClients: { codex: codexClient },
      mcpEnabled: false,
      relayEnabled: false,
    });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    try {
      await client.connect();
      expect(client.getLastServerInfoMessage()?.features?.agentNativeFork).toBe(true);
      const source = await client.createAgent({
        provider: "codex",
        cwd: os.tmpdir(),
        title: "原对话",
      });
      const finishPromise = client.waitForFinish(source.id);
      await client.sendAgentMessage(source.id, "你好");
      await appServer.waitForTurnStart();
      appServer.startsTurn({ threadId: "thread-1", turnId: "turn-1" });
      appServer.says({ threadId: "thread-1", text: "你好！" });
      appServer.completeTurn({ threadId: "thread-1" });
      await finishPromise;
      const forked = await client.forkAgent({ agentId: source.id });
      expect(forked.id).not.toBe(source.id);
      expect(forked.title).toBe("原对话 (分叉)");
      expect(forked.persistence?.sessionId).toBe("forked-thread");
    } finally {
      await client.close();
      await daemon.close();
    }
  }, 20000);
});
