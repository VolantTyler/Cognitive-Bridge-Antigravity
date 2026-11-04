import { describe, expect, it } from "vitest";
import { LEGACY_ACCESS_CUTOFF_ISO, isLegacyAccess, legacyCutoffMs } from "./legacyAccess";

describe("legacy access cutoff", () => {
  it("uses document create time, not a client field, and honors an env override", () => {
    const cutoff = Date.parse(LEGACY_ACCESS_CUTOFF_ISO);
    expect(isLegacyAccess(cutoff - 1, cutoff)).toBe(true);
    expect(isLegacyAccess(cutoff, cutoff)).toBe(false);
    expect(isLegacyAccess(null, cutoff)).toBe(false);
    expect(legacyCutoffMs({ LEGACY_ACCESS_CUTOFF: "2026-12-01T05:00:00.000Z" })).toBe(Date.parse("2026-12-01T05:00:00.000Z"));
    expect(legacyCutoffMs({})).toBe(cutoff);
  });
});
