import { describe, expect, it } from "vitest";
import { clampThinkingBudget, mirrorThinkingBudget } from "./mirrorThinking";

function users(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: "user",
    content: `answer ${index + 1}`,
  }));
}

describe("mirror thinking budget", () => {
  it("turns thinking off for replies to answers 1-4, even if the client says final", () => {
    const decision = mirrorThinkingBudget({
      feature: "mirror",
      model: "gemini-2.5-flash",
      messages: users(2),
      turnIndex: 5,
      isFinalTurn: true,
      envValue: "1024",
    });
    expect(decision.thinkingBudget).toBe(0);
    expect(decision.clientAgrees).toBe(false);
  });

  it("uses the scoring budget after the 5th answer, even if the client says otherwise", () => {
    const decision = mirrorThinkingBudget({
      feature: "mirror",
      model: "models/gemini-2.5-flash",
      messages: users(5),
      turnIndex: 4,
      isFinalTurn: false,
      envValue: "1024",
    });
    expect(decision.thinkingBudget).toBe(1024);
    expect(decision.clientAgrees).toBe(false);
  });

  it("reads the env budget, treats 0 as off, and clamps to 0..8192", () => {
    expect(clampThinkingBudget(undefined)).toBe(1024);
    expect(clampThinkingBudget("")).toBe(1024);
    expect(clampThinkingBudget("nope")).toBe(1024);
    expect(clampThinkingBudget("0")).toBe(0);
    expect(clampThinkingBudget("-4")).toBe(0);
    expect(clampThinkingBudget("9000")).toBe(8192);
    expect(clampThinkingBudget("100.9")).toBe(100);

    const off = mirrorThinkingBudget({
      feature: "mirror",
      model: "gemini-2.5-flash",
      messages: users(5),
      turnIndex: 5,
      isFinalTurn: true,
      envValue: "0",
    });
    expect(off.thinkingBudget).toBe(0);
    expect(off.clientAgrees).toBe(true);
  });

  it("leaves other features and models unset", () => {
    expect(mirrorThinkingBudget({
      feature: "playground-aligned",
      model: "gemini-2.5-flash",
      messages: users(5),
      isFinalTurn: true,
    }).thinkingBudget).toBeUndefined();
    expect(mirrorThinkingBudget({
      feature: "mirror",
      model: "gemini-2.5-flash-lite",
      messages: users(5),
      isFinalTurn: true,
      envValue: "1024",
    }).thinkingBudget).toBeUndefined();
    expect(mirrorThinkingBudget({
      feature: "judge",
      model: "gemini-2.5-flash",
      messages: users(5),
    }).thinkingBudget).toBeUndefined();
  });
});
