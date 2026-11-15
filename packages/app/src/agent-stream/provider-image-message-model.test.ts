import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  getStandaloneMarkdownImages,
  groupConsecutiveImageMessages,
  groupProviderImageSegments,
} from "./provider-image-message-model";

function image(id: string, turnId = "turn-1"): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    turnId,
    timestamp: new Date(0),
    text: `![${id}](file:///C:/images/${id}.png)`,
  };
}

describe("连续已查看图像", () => {
  it("同一消息中的多张图像保留顺序与重复图片的独立键", () => {
    const images = getStandaloneMarkdownImages(`${image("one").text}\n\n${image("one").text}`);
    expect(images?.map((item) => item.key)).toEqual([
      "file:///C:/images/one.png:0",
      "file:///C:/images/one.png:1",
    ]);
  });
  it("紧邻图像合并为一个展示项，保留首条身份且不修改原数据", () => {
    const items = [image("one"), image("two"), image("three")];
    const grouped = groupConsecutiveImageMessages(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe("one");
    expect(
      grouped[0].kind === "assistant_message" && getStandaloneMarkdownImages(grouped[0].text),
    ).toHaveLength(3);
    expect(items[0].text).toBe(image("one").text);
    expect(groupConsecutiveImageMessages(items)).toBe(grouped);
  });
  it("正文、用户消息和回合边界阻断合并", () => {
    const text: StreamItem = { ...image("text"), text: "继续分析" };
    const user: StreamItem = {
      kind: "user_message",
      id: "user",
      text: "继续",
      timestamp: new Date(0),
    };
    const items = [image("one"), text, image("two"), user, image("three"), image("four", "turn-2")];
    expect(groupConsecutiveImageMessages(items)).toBe(items);
  });
  it("历史与实时段交界的连续图像仍归为同一组", () => {
    const segments = groupProviderImageSegments([image("one")], [image("two"), image("three")]);
    expect(segments.tail).toHaveLength(1);
    expect(segments.head).toHaveLength(0);
    expect(
      segments.tail[0].kind === "assistant_message" &&
        getStandaloneMarkdownImages(segments.tail[0].text),
    ).toHaveLength(3);
  });
  it("非连续图像的实时段保留原引用", () => {
    const tail = [image("one")],
      head = [image("two", "turn-2")];
    expect(groupProviderImageSegments(tail, head)).toEqual({ tail, head });
    expect(groupProviderImageSegments(tail, head).head).toBe(head);
  });
});
