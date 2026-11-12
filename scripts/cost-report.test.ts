import { describe, expect, it } from "vitest";
import { costForRow, formatSummary, loadPricing, percentile, summarizeSessions } from "./cost-report";

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

    expect(summary.interviewCount).toBe(2);
    expect(summary.skippedWithoutSession).toBe(1);
    expect(summary.medianTokens).toBe(percentile([1_000_000, 2_000_000], 0.5));
    expect(summary.p90Tokens).toBe(percentile([1_000_000, 2_000_000], 0.9));
    const flash = table.models["gemini-2.5-flash"];
    expect(costForRow(
      { model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 },
      table
    )).toBeCloseTo(flash.inputPerMillionUsd);
    const mirror = summary.interviews.find((item) => item.id === "a");
    expect(mirror?.calls).toBe(2);
    expect(mirror?.usdByFeature.judge).toBe(0);
    expect(mirror?.usd).toBeCloseTo(flash.inputPerMillionUsd);
    expect(summary.medianUsd).toBeGreaterThan(0);
    expect(summary.p90Usd).toBeGreaterThanOrEqual(summary.medianUsd);
  });

  it("groups by reservationId, falls back to sessionId, and prices judge rows at $0", () => {
    const table = loadPricing();
    const summary = summarizeSessions([
      { reservationId: "iv-1", sessionId: "tab", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 },
      { reservationId: "iv-1", sessionId: "tab", feature: "judge", model: "jev-latest", promptTokens: 0, completionTokens: 0 },
      { reservationId: "iv-2", sessionId: "tab", feature: "chat", model: "gemini-2.5-flash", promptTokens: 0, completionTokens: 1_000_000 },
      { reservationId: "   ", sessionId: "legacy", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 500_000, completionTokens: 0 },
      { feature: "judge", model: "jev-latest", promptTokens: 10, completionTokens: 10 },
    ], table);

    expect(summary.interviewCount).toBe(3);
    expect(summary.skippedWithoutSession).toBe(1);
    const byId = Object.fromEntries(summary.interviews.map((item) => [item.id, item]));
    expect(byId["iv-1"].calls).toBe(2);
    expect(byId["iv-1"].tokens).toBe(1_000_000);
    expect(byId["iv-1"].usdByFeature.mirror).toBeCloseTo(table.models["gemini-2.5-flash"].inputPerMillionUsd);
    expect(byId["iv-1"].usdByFeature.judge).toBe(0);
    expect(byId["iv-1"].usd).toBeCloseTo(byId["iv-1"].usdByFeature.mirror);
    expect(byId["iv-2"].usd).toBeCloseTo(table.models["gemini-2.5-flash"].outputPerMillionUsd);
    expect(byId["iv-2"].id).not.toBe("tab");
    expect(byId.legacy.tokens).toBe(500_000);
    expect(summary.medianUsd).toBeCloseTo(byId["iv-1"].usd);
    expect(summary.p90Usd).toBeGreaterThan(summary.medianUsd);

    const text = formatSummary(summary, table);
    expect(text).toMatch(/PLACEHOLDERS/);
    expect(text).toMatch(/Jev judge rows record \$0/);
    expect(text).toContain("iv-1");
    expect(text).toContain("iv-2");
    expect(text).toContain(`Median estimated USD per interview: ${summary.medianUsd.toFixed(6)}`);
    expect(text).toContain(`P90 estimated USD per interview: ${summary.p90Usd.toFixed(6)}`);
  });
});
