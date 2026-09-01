import { describe, expect, it } from "vitest";

import {
  advanceTextReveal,
  beginTextReveal,
  clampToSafeRevealBoundary,
  completeTextReveal,
  computeRevealStep,
  nextTextRevealFrame,
  isTextRevealSettled,
  retargetTextReveal,
  TEXT_REVEAL_FRAME_INTERVAL_MS,
  TEXT_REVEAL_HORIZON_MS,
  visibleRevealedText,
} from "./text-reveal";

describe("computeRevealStep", () => {
  it("reveals nothing when there is no backlog", () => {
    expect(computeRevealStep({ backlog: 0, elapsedMs: 16 })).toBe(0);
    expect(computeRevealStep({ backlog: -5, elapsedMs: 16 })).toBe(0);
  });

  it("drains the backlog over the horizon", () => {
    const step = computeRevealStep({ backlog: 300, elapsedMs: TEXT_REVEAL_HORIZON_MS / 2 });
    expect(step).toBe(150);
  });

  it("reveals the whole backlog once a frame covers the horizon", () => {
    expect(computeRevealStep({ backlog: 42, elapsedMs: TEXT_REVEAL_HORIZON_MS })).toBe(42);
    expect(computeRevealStep({ backlog: 42, elapsedMs: TEXT_REVEAL_HORIZON_MS * 10 })).toBe(42);
  });

  it("scales the rate with the backlog so a faster model reveals faster", () => {
    const slow = computeRevealStep({ backlog: 20, elapsedMs: 16 });
    const fast = computeRevealStep({ backlog: 200, elapsedMs: 16 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("always advances at least one character so the tail finishes", () => {
    expect(computeRevealStep({ backlog: 1, elapsedMs: 1 })).toBe(1);
    expect(computeRevealStep({ backlog: 2, elapsedMs: 0.01 })).toBe(1);
  });

  it("never overshoots the backlog", () => {
    for (const backlog of [1, 3, 7, 50]) {
      expect(computeRevealStep({ backlog, elapsedMs: 120 })).toBeLessThanOrEqual(backlog);
    }
  });

  it("reveals nothing when no time has passed", () => {
    expect(computeRevealStep({ backlog: 100, elapsedMs: 0 })).toBe(0);
    expect(computeRevealStep({ backlog: 100, elapsedMs: -16 })).toBe(0);
  });

  it("converges within a bounded number of frames at 60Hz", () => {
    let remaining = 500;
    let frames = 0;
    while (remaining > 0) {
      remaining -= computeRevealStep({ backlog: remaining, elapsedMs: 16 });
      frames += 1;
      expect(frames).toBeLessThan(120);
    }
    expect(remaining).toBe(0);
  });

  it("keeps per-frame steps smooth for a bursty arrival pattern", () => {
    // 模拟不均匀到达：守护进程每个合并窗口携带的字符数会随模型速度剧烈变化。
    const arrivals = [4, 180, 6, 240, 2, 90, 300, 8];
    const steps: number[] = [];
    let backlog = 0;

    for (const arrival of arrivals) {
      backlog += arrival;
      // 两次合并刷新之间约有 60 毫秒的帧。
      for (let frame = 0; frame < 4; frame += 1) {
        const step = computeRevealStep({ backlog, elapsedMs: 16 });
        backlog -= step;
        steps.push(step);
      }
    }

    // 直接绘制会让单帧在 2 到 300 个字符间跳变；节奏控制显著压低最大单帧增量。
    expect(Math.max(...steps)).toBeLessThan(Math.max(...arrivals) / 2);
    expect(Math.min(...steps)).toBeGreaterThan(0);
  });
});

describe("clampToSafeRevealBoundary", () => {
  it("leaves boundaries in plain text alone", () => {
    expect(clampToSafeRevealBoundary("hello world", 5)).toBe(5);
  });

  it("clamps the ends", () => {
    expect(clampToSafeRevealBoundary("hello", -3)).toBe(0);
    expect(clampToSafeRevealBoundary("hello", 99)).toBe(5);
  });

  it("never splits a surrogate pair", () => {
    // “a😀b” 中的表情占用索引 1 和 2。
    const text = "a😀b";
    expect(clampToSafeRevealBoundary(text, 2)).toBe(1);
    expect(clampToSafeRevealBoundary(text, 3)).toBe(3);
  });

  it("does not strand a combining mark", () => {
    // “e” 加组合重音；在索引 1 切开会先显示裸 “e”，随后重新排版。
    const text = `éx`;
    expect(clampToSafeRevealBoundary(text, 1)).toBe(0);
    expect(clampToSafeRevealBoundary(text, 2)).toBe(2);
  });

  it("does not split an emoji ZWJ sequence", () => {
    // 家庭表情由人物、零宽连接符、人物、零宽连接符和儿童组成。
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const text = `${family}!`;
    for (let index = 1; index < family.length; index += 1) {
      expect(clampToSafeRevealBoundary(text, index)).toBe(0);
    }
    expect(clampToSafeRevealBoundary(text, family.length)).toBe(family.length);
  });

  it("does not split a skin tone modifier from its base", () => {
    const text = "\u{1F44D}\u{1F3FD} nice";
    expect(clampToSafeRevealBoundary(text, 2)).toBe(0);
    expect(clampToSafeRevealBoundary(text, 4)).toBe(4);
  });

  it("does not strand a variation selector", () => {
    const text = "❤️ done";
    expect(clampToSafeRevealBoundary(text, 1)).toBe(0);
    expect(clampToSafeRevealBoundary(text, 2)).toBe(2);
  });

  it("does not split extended grapheme clusters", () => {
    for (const { text, boundaries } of [
      { text: "a🇺🇸b", boundaries: [0, 1, 5, 6] },
      { text: "a가b", boundaries: [0, 1, 3, 4] },
      { text: "aकःb", boundaries: [0, 1, 3, 4] },
    ]) {
      for (let index = 1; index < text.length; index += 1) {
        const expected = boundaries.toReversed().find((boundary) => boundary <= index);
        expect(clampToSafeRevealBoundary(text, index)).toBe(expected);
      }
    }
  });
});

describe("nextTextRevealFrame", () => {
  it("caps a high-refresh frame clock at 60Hz", () => {
    expect(nextTextRevealFrame(null, 0)).toEqual({
      elapsedMs: TEXT_REVEAL_FRAME_INTERVAL_MS,
      frameAtMs: 0,
    });
    expect(nextTextRevealFrame(0, 8)).toBeNull();
    expect(nextTextRevealFrame(0, 17)).toEqual({
      elapsedMs: 17,
      frameAtMs: expect.closeTo(TEXT_REVEAL_FRAME_INTERVAL_MS, 5),
    });
  });
});

describe("text reveal state", () => {
  it("reveals the first text it sees in full", () => {
    const state = beginTextReveal("already here");
    expect(visibleRevealedText(state)).toBe("already here");
    expect(isTextRevealSettled(state)).toBe(true);
  });

  it("paces growth instead of painting it whole", () => {
    let state = beginTextReveal("a");
    state = retargetTextReveal(state, `a${"b".repeat(300)}`);
    expect(visibleRevealedText(state)).toBe("a");

    state = advanceTextReveal(state, 16);
    const shown = visibleRevealedText(state);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(301);
  });

  it("catches up to the full text across frames", () => {
    const full = `a${"b".repeat(200)}`;
    let state = retargetTextReveal(beginTextReveal("a"), full);
    for (let frame = 0; frame < 60 && !isTextRevealSettled(state); frame += 1) {
      state = advanceTextReveal(state, 16);
    }
    expect(isTextRevealSettled(state)).toBe(true);
    expect(visibleRevealedText(state)).toBe(full);
  });

  it("releases everything when the turn completes", () => {
    const full = `a${"b".repeat(500)}`;
    let state = advanceTextReveal(retargetTextReveal(beginTextReveal("a"), full), 16);
    expect(visibleRevealedText(state)).not.toBe(full);

    state = completeTextReveal(state);
    expect(visibleRevealedText(state)).toBe(full);
  });

  it("only ever paints a prefix of the real text", () => {
    const full = "the quick brown fox jumps over the lazy dog";
    let state = retargetTextReveal(beginTextReveal("the "), full);
    for (let frame = 0; frame < 20; frame += 1) {
      expect(full.startsWith(visibleRevealedText(state))).toBe(true);
      state = advanceTextReveal(state, 16);
    }
  });

  it("clamps when the slot switches to a shorter message", () => {
    const state = retargetTextReveal(beginTextReveal("a long streaming message"), "short");
    expect(visibleRevealedText(state)).toBe("short");
  });

  it("never paints a lone surrogate while streaming emoji", () => {
    const full = `progress ${"\u{1F680}".repeat(40)} done`;
    let state = retargetTextReveal(beginTextReveal("progress "), full);
    for (let frame = 0; frame < 200 && !isTextRevealSettled(state); frame += 1) {
      const shown = visibleRevealedText(state);
      // 悬空代理项会让已绘制前缀无法解码。
      expect(shown).toBe(Array.from(shown).join(""));
      expect(full.startsWith(shown)).toBe(true);
      state = advanceTextReveal(state, 16);
    }
    expect(visibleRevealedText(completeTextReveal(state))).toBe(full);
  });

  it("a long cluster cannot stall the reveal", () => {
    // 渲染边界会越过这个字素簇回退，但进度计数不回退，因此仍能最终完成。
    const full = `x${"́".repeat(40)}y`;
    let state = retargetTextReveal(beginTextReveal("x"), full);
    for (let frame = 0; frame < 200 && !isTextRevealSettled(state); frame += 1) {
      state = advanceTextReveal(state, 16);
    }
    expect(isTextRevealSettled(state)).toBe(true);
    expect(visibleRevealedText(state)).toBe(full);
  });
});

describe("trailing fragments from arrival boundaries", () => {
  it("holds back half a flag while more text is coming", () => {
    // 守护进程的合并窗口可能在字素簇中间结束，让已追平的显示拿到单个区域指示符。
    const halfFlag = "flags: \u{1F1EC}";
    const state = beginTextReveal(halfFlag);
    expect(visibleRevealedText(state, { streaming: true })).toBe("flags: ");
    // 回合结束后不会再有内容，因此显示当前已有文本。
    expect(visibleRevealedText(state, { streaming: false })).toBe(halfFlag);
  });

  it("paints the flag once its second half arrives", () => {
    const whole = "flags: \u{1F1EC}\u{1F1E7}";
    expect(visibleRevealedText(beginTextReveal(whole), { streaming: true })).toBe(whole);
  });

  it("keeps an even run of regional indicators intact", () => {
    const twoFlags = "\u{1F1EC}\u{1F1E7}\u{1F1EB}\u{1F1F7}";
    expect(visibleRevealedText(beginTextReveal(twoFlags), { streaming: true })).toBe(twoFlags);
  });

  it("holds back a dangling joiner", () => {
    expect(
      visibleRevealedText(beginTextReveal("family: \u{1F468}\u200D"), { streaming: true }),
    ).toBe("family: \u{1F468}");
  });

  it("holds back a dangling high surrogate", () => {
    const loneHigh = `broken: ${String.fromCharCode(0xd83d)}`;
    expect(visibleRevealedText(beginTextReveal(loneHigh), { streaming: true })).toBe("broken: ");
  });

  it("leaves ordinary trailing text alone", () => {
    const prose = "just some prose";
    expect(visibleRevealedText(beginTextReveal(prose), { streaming: true })).toBe(prose);
  });
});
