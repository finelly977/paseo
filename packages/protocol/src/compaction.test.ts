import { expect, test } from "vitest";
import { AgentTimelineItemPayloadSchema } from "./messages.js";

test("压缩的原生标识经过协议解析保留，没有标识的提供方仍可正常投递", () => {
  expect(
    AgentTimelineItemPayloadSchema.parse({
      type: "compaction",
      status: "completed",
      compactionId: "native-compaction",
    }),
  ).toEqual({ type: "compaction", status: "completed", compactionId: "native-compaction" });
  expect(AgentTimelineItemPayloadSchema.parse({ type: "compaction", status: "loading" })).toEqual({
    type: "compaction",
    status: "loading",
  });
});
