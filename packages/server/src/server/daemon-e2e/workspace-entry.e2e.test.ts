import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createDaemonTestContext } from "../test-utils/index.js";

test("通过真实 WebSocket 完成文件与目录增删改查，错误后可重试", async () => {
  const ctx = await createDaemonTestContext({ agentClients: {} });
  const cwd = await mkdtemp(path.join(tmpdir(), "paseo-entry-rpc-"));
  try {
    expect(ctx.client.getLastServerInfoMessage()?.features?.workspaceEntryMutation).toBe(true);
    await ctx.client.mutateWorkspaceEntry({
      cwd,
      mutation: { operation: "create", path: "新目录", kind: "directory" },
    });
    await ctx.client.mutateWorkspaceEntry({
      cwd,
      mutation: { operation: "create", path: "新目录/a.txt", kind: "file" },
    });
    await expect(
      ctx.client.mutateWorkspaceEntry({
        cwd,
        mutation: { operation: "create", path: "新目录/a.txt", kind: "file" },
      }),
    ).rejects.toThrow("同名");
    const file = await ctx.client.readFile(cwd, "新目录/a.txt");
    const written = await ctx.client.writeFile({
      cwd,
      path: file.path,
      content: "hello world",
      expectedModifiedAt: file.modifiedAt,
      expectedRevision: file.revision,
    });
    expect(written.status).toBe("written");
    expect(await readFile(path.join(cwd, "新目录/a.txt"), "utf8")).toBe("hello world");
    const entry = (await ctx.client.listDirectory(cwd, "新目录")).entries[0];
    await expect(
      ctx.client.mutateWorkspaceEntry({
        cwd,
        mutation: {
          operation: "rename",
          path: entry.path,
          name: "b.txt",
          expectedModifiedAt: "2000-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("已发生变化");
    await ctx.client.mutateWorkspaceEntry({
      cwd,
      mutation: {
        operation: "rename",
        path: entry.path,
        name: "b.txt",
        expectedModifiedAt: entry.modifiedAt,
      },
    });
    expect(
      (await ctx.client.listDirectory(cwd, "新目录")).entries.map((item) => item.name),
    ).toEqual(["b.txt"]);
    const directory = (await ctx.client.listDirectory(cwd, ".")).entries[0];
    await ctx.client.mutateWorkspaceEntry({
      cwd,
      mutation: {
        operation: "delete",
        path: directory.path,
        expectedModifiedAt: directory.modifiedAt,
      },
    });
    expect(await readdir(cwd)).toEqual([]);
    await expect(
      ctx.client.mutateWorkspaceEntry({
        cwd,
        mutation: { operation: "delete", path: ".", expectedModifiedAt: "" },
      }),
    ).rejects.toThrow("根目录");
  } finally {
    await ctx.cleanup();
    await rm(cwd, { recursive: true, force: true });
  }
}, 60_000);
