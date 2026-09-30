import { mkdtemp, readFile, rm, writeFile, mkdir, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { mutateExplorerEntry, listDirectoryEntries } from "./service.js";

test("新建文件与目录，已有目标不会被覆盖", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-entry-"));
  try {
    await mutateExplorerEntry({
      root,
      mutation: { operation: "create", path: "资料", kind: "directory" },
    });
    await mutateExplorerEntry({
      root,
      mutation: { operation: "create", path: "资料/说明.txt", kind: "file" },
    });
    expect(await readFile(path.join(root, "资料/说明.txt"), "utf8")).toBe("");
    await writeFile(path.join(root, "资料/说明.txt"), "保留");
    await expect(
      mutateExplorerEntry({
        root,
        mutation: { operation: "create", path: "资料/说明.txt", kind: "file" },
      }),
    ).rejects.toThrow();
    expect(await readFile(path.join(root, "资料/说明.txt"), "utf8")).toBe("保留");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("重命名及删除目录，不覆盖同名目标，拒绝陈旧操作", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-entry-"));
  try {
    await mkdir(path.join(root, "目录"));
    await writeFile(path.join(root, "目录/a.txt"), "hello");
    const listing = await listDirectoryEntries({ root });
    const directory = listing.entries[0];
    expect(directory.name).toBe("目录");
    await expect(
      mutateExplorerEntry({
        root,
        mutation: {
          operation: "rename",
          path: directory.path,
          name: "新目录",
          expectedModifiedAt: "2000-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("已发生变化");
    await mutateExplorerEntry({
      root,
      mutation: {
        operation: "rename",
        path: directory.path,
        name: "新目录",
        expectedModifiedAt: directory.modifiedAt,
      },
    });
    expect(await readFile(path.join(root, "新目录/a.txt"), "utf8")).toBe("hello");
    await mkdir(path.join(root, "占用"));
    const next = (await listDirectoryEntries({ root })).entries.find(
      (entry) => entry.name === "新目录",
    );
    if (!next) throw new Error("目录应存在");
    await expect(
      mutateExplorerEntry({
        root,
        mutation: {
          operation: "rename",
          path: next.path,
          name: "占用",
          expectedModifiedAt: next.modifiedAt,
        },
      }),
    ).rejects.toThrow("同名");
    await mutateExplorerEntry({
      root,
      mutation: { operation: "delete", path: next.path, expectedModifiedAt: next.modifiedAt },
    });
    expect(await readdir(root)).toEqual(["占用"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不能删除工作区根目录或在范围之外创建文件", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-entry-"));
  try {
    await expect(
      mutateExplorerEntry({
        root,
        mutation: { operation: "delete", path: ".", expectedModifiedAt: "" },
      }),
    ).rejects.toThrow("根目录");
    await expect(
      mutateExplorerEntry({
        root,
        mutation: { operation: "create", path: "../outside.txt", kind: "file" },
      }),
    ).rejects.toThrow("以外");
    await expect(
      mutateExplorerEntry({
        root,
        mutation: { operation: "create", path: "missing/a.txt", kind: "file" },
      }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("父目录链接不能绕过范围校验，递归删除不会删除链接的外部目标", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-entry-"));
  const outside = await mkdtemp(path.join(tmpdir(), "paseo-entry-outside-"));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  try {
    await writeFile(path.join(outside, "keep.txt"), "保留");
    await mkdir(path.join(root, "folder"));
    await symlink(outside, path.join(root, "folder", "outside"), linkType);
    await expect(
      mutateExplorerEntry({
        root,
        mutation: { operation: "create", path: "folder/outside/attack.txt", kind: "file" },
      }),
    ).rejects.toThrow("outside of workspace");
    const entry = (await listDirectoryEntries({ root })).entries[0];
    await mutateExplorerEntry({
      root,
      mutation: { operation: "delete", path: entry.path, expectedModifiedAt: entry.modifiedAt },
    });
    expect(await readFile(path.join(outside, "keep.txt"), "utf8")).toBe("保留");
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
