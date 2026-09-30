import { expect, test } from "vitest";
import { createWorkspacePreviewServer } from "./server.js";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workspacePreviewMimeType } from "@getpaseo/protocol/workspace-preview";

test("真实 HTTP 预览支持子目录 HTML、相对和根路径资源，拒绝无授权访问", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-html-"));
  await mkdir(path.join(root, "pages"));
  await writeFile(
    path.join(root, "pages/index.html"),
    '<link href="../style.css" rel="stylesheet"><h1>预览</h1>',
  );
  await writeFile(path.join(root, "style.css"), "h1 { color: red }");
  const readPaths: string[] = [];
  const server = await createWorkspacePreviewServer(async (asset) => {
    readPaths.push(asset);
    return {
      status: "file",
      bytes: new Uint8Array(await readFile(path.join(root, asset))),
      mimeType: workspacePreviewMimeType(asset),
    };
  });
  try {
    const openUrl = server.open("pages/index.html");
    const origin = new URL(openUrl).origin;
    expect((await fetch(`${origin}/style.css`)).status).toBe(403);
    const bootstrap = await fetch(openUrl, { redirect: "manual" });
    expect(bootstrap.status).toBe(302);
    expect(bootstrap.headers.get("location")).toBe("/pages/index.html");
    const cookie = bootstrap.headers.get("set-cookie");
    if (!cookie) throw new Error("预览授权 Cookie 缺失");
    const headers = { Cookie: cookie.split(";")[0] };
    const html = await fetch(`${origin}/pages/index.html`, { headers });
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await html.text()).toContain("<h1>预览</h1>");
    const css = await fetch(new URL("../style.css", `${origin}/pages/index.html`), { headers });
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await css.text()).toBe("h1 { color: red }");
    expect((await fetch(`${origin}/.env`, { headers })).status).toBe(403);
    expect((await fetch(`${origin}/pages/index.html`, { headers, method: "POST" })).status).toBe(
      405,
    );
    expect(readPaths).toEqual(["pages/index.html", "style.css"]);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("预览读取失败返回明确错误，随后可刷新重试", async () => {
  let fail = true;
  const server = await createWorkspacePreviewServer(async () => {
    if (fail) return { status: "error", error: "主机未连接" };
    return {
      status: "file",
      bytes: new TextEncoder().encode("恢复成功"),
      mimeType: "text/html; charset=utf-8",
    };
  });
  try {
    const url = server.open("index.html");
    const bootstrap = await fetch(url, { redirect: "manual" });
    const cookie = bootstrap.headers.get("set-cookie");
    if (!cookie) throw new Error("预览授权 Cookie 缺失");
    const target = new URL("/index.html", url);
    const headers = { Cookie: cookie.split(";")[0] };
    const failure = await fetch(target, { headers });
    expect(failure.status).toBe(404);
    expect(await failure.text()).toBe("主机未连接");
    fail = false;
    expect(await (await fetch(target, { headers })).text()).toBe("恢复成功");
  } finally {
    await server.close();
  }
});
