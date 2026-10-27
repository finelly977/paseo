import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedMarkdownStyle } from "../node_modules/react-native-markdown-display/src/lib/styleCache.js";

test("不同正文共用等值主题样式的编译结果", () => {
  const first = cachedMarkdownStyle(true, { body: { color: "#121212", fontSize: 16 } }, () => ({
    compiled: 1,
  }));
  const second = cachedMarkdownStyle(true, { body: { color: "#121212", fontSize: 16 } }, () => {
    throw new Error("重复编译");
  });
  assert.equal(second, first);
});

test("换主题、字号和合并选项不会命中旧样式", () => {
  const compile = () => ({});
  const original = cachedMarkdownStyle(true, { body: { color: "#fefefe", fontSize: 16 } }, compile);
  const color = cachedMarkdownStyle(true, { body: { color: "#111111", fontSize: 16 } }, compile);
  const size = cachedMarkdownStyle(true, { body: { color: "#fefefe", fontSize: 18 } }, compile);
  const merge = cachedMarkdownStyle(false, { body: { color: "#fefefe", fontSize: 16 } }, compile);
  assert.notEqual(original, color);
  assert.notEqual(original, size);
  assert.notEqual(original, merge);
});

test("缓存有界，淘汰后正常重编译", () => {
  let builds = 0;
  const compile = () => ({ build: ++builds });
  cachedMarkdownStyle(true, { cacheEviction: "oldest" }, compile);
  for (let index = 0; index < 40; index++)
    cachedMarkdownStyle(true, { cacheEviction: index }, compile);
  const recreated = cachedMarkdownStyle(true, { cacheEviction: "oldest" }, compile);
  assert.equal(recreated.build, 42);
});
