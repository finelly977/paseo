import { expect, test } from "vitest";
import { resolveUserMessageFooterVisibility } from "./user-message-footer";

test.each([
  { touchLayout: true, hovered: false, actions: true, timestamp: false },
  { touchLayout: true, hovered: true, actions: true, timestamp: false },
  { touchLayout: false, hovered: false, actions: false, timestamp: false },
  { touchLayout: false, hovered: true, actions: true, timestamp: true },
])("消息操作与时间分别显示：%j", ({ touchLayout, hovered, actions, timestamp }) => {
  expect(resolveUserMessageFooterVisibility({ hasText: true, touchLayout, hovered })).toEqual({
    actions,
    timestamp,
  });
  expect(resolveUserMessageFooterVisibility({ hasText: false, touchLayout, hovered })).toEqual({
    actions: false,
    timestamp: false,
  });
});
