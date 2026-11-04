import { describe, expect, it } from "vitest";
import { costCapMessage } from "./accessCopy";
import {
  assertUnderDailyCostCap,
  costCapReachedError,
  dailyCostDocPath,
  isDailyCostCapped,
  microsOnDay,
} from "./dailyCost";
import { costMicrosForUsage, costUsdForUsage, highestPrice, priceForModel } from "./pricing";

describe("daily dollar cap", () => {
  it("passes under the cap and returns 429 at or over it", async () => {
    await expect(assertUnderDailyCostCap({ spentMicros: 999_999, capUsd: 1 })).resolves.toBeUndefined();
    await expect(assertUnderDailyCostCap({ spentMicros: 1_000_000, capUsd: 1 })).rejects.toMatchObject({
      status: 429,
      code: "cost_cap_reached",
      message: costCapMessage(),
    });
    expect(isDailyCostCapped(1_000_000, 1)).toBe(true);
    expect(costCapReachedError().message).toBe("You've reached today's chat limit. It resets at midnight US Eastern.");
    expect(costCapMessage()).not.toMatch(/dollar|cost|\$/i);
  });

  it("resets when the US Eastern day changes", () => {
    expect(microsOnDay("2026-11-04", 2_000_000, "2026-11-05")).toBe(0);
    expect(microsOnDay("2026-11-05", 400_000, "2026-11-05")).toBe(400_000);
    expect(dailyCostDocPath("user-1", "2026-11-04")).not.toBe(dailyCostDocPath("user-1", "2026-11-05"));
    expect(isDailyCostCapped(microsOnDay("2026-11-04", 2_000_000, "2026-11-05"), 1)).toBe(false);
  });
});

describe("model prices", () => {
  it("prices an unknown model at the highest known card", () => {
    const highest = highestPrice();
    expect(highest.outputPerMillionUsd).toBe(10);
    expect(priceForModel("not-a-real-model")).toEqual(highest);
    expect(priceForModel(undefined)).toEqual(highest);
    const usd = costUsdForUsage({ model: "mystery-model", promptTokens: 1_000_000, completionTokens: 0 });
    expect(usd).toBeCloseTo(highest.inputPerMillionUsd);
    expect(costMicrosForUsage({ model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 }))
      .toBe(Math.round(0.15 * 1_000_000));
  });
});
