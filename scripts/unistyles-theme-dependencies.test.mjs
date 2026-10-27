import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { deepMergeObjects as mergeEsm } from "../node_modules/react-native-unistyles/lib/module/utils.js";

const require = createRequire(import.meta.url);
const {
  deepMergeObjects: mergeCommonJs,
} = require("../node_modules/react-native-unistyles/lib/commonjs/utils.js");

for (const [entry, deepMergeObjects] of [
  ["ESM", mergeEsm],
  ["CommonJS", mergeCommonJs],
]) {
  test(`${entry}：合并多组主题样式后仍保留主题订阅`, () => {
    const merged = deepMergeObjects(
      { backgroundColor: "#202224", uni__dependencies: [0] },
      { color: "#d3d3d3", uni__dependencies: [0] },
      { width: 18 },
    );
    assert.deepEqual(merged.uni__dependencies, [0]);
  });

  test(`${entry}：合并主题、字号和断点依赖时去重而不覆盖`, () => {
    const merged = deepMergeObjects(
      { uni__dependencies: [0, 1] },
      { uni__dependencies: [1, 2] },
      { uni__dependencies: [] },
    );
    assert.deepEqual(merged.uni__dependencies, [0, 1, 2]);
  });

  test(`${entry}：变体和嵌套样式的依赖也保留数组类型`, () => {
    const merged = deepMergeObjects(
      { selected: { uni__dependencies: [0] } },
      { selected: { uni__dependencies: [1] } },
    );
    assert.deepEqual(merged.selected.uni__dependencies, [0, 1]);
  });

  test(`${entry}：普通样式仍以后者覆盖前者且不修改输入`, () => {
    const base = { backgroundColor: "#202224", uni__dependencies: [0] };
    const selected = { backgroundColor: "#eef1f5", uni__dependencies: [1] };
    assert.deepEqual(deepMergeObjects(base, selected), {
      backgroundColor: "#eef1f5",
      uni__dependencies: [0, 1],
    });
    assert.deepEqual(base.uni__dependencies, [0]);
    assert.deepEqual(selected.uni__dependencies, [1]);
  });
}
