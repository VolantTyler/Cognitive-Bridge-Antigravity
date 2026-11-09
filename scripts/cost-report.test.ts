import { describe, expect, it } from "vitest";
import { costForRow, loadPricing, percentile, summarizeSessions } from "./cost-report";

describe("cost report", () => {
  it("reports median and p90 tokens and placeholder dollars per session", () => {
    const table = loadPricing();
    expect(table.placeholder).toBe(true);
    expect(table.comment).toMatch(/PLACEHOLDER/);

    const summary = summarizeSessions([
      { sessionId: "a", model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0, feature: "mirror" },
      { sessionId: "a", model: "jev-latest", promptTokens: 0, completionTokens: 0, feature: "judge" },
      { sessionId: "b", model: "gemini-2.5-flash", promptTokens: 0, completionTokens: 2_000_000, feature: "bridge" },
      { sessionId: null, model: "gemini-2.5-flash", promptTokens: 50, completionTokens: 50 },
    ], table);

    expect(summary.sessionCount).toBe(2);
    expect(summary.skippedWithoutSession).toBe(1);
    expect(summary.medianTokens).toBe(percentile([1_000_000, 2_000_000], 0.5));
    expect(summary.p90Tokens).toBe(percentile([1_000_000, 2_000_000], 0.9));
    const flash = table.models["gemini-2.5-flash"];
    expect(costForRow(
      { model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 },
      table
    )).toBeCloseTo(flash.inputPerMillionUsd);
    expect(summary.medianUsd).toBeGreaterThan(0);
    expect(summary.p90Usd).toBeGreaterThanOrEqual(summary.medianUsd);
  });
});
