import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({
  logAnalyticsEvent: vi.fn(),
}));

import { logAnalyticsEvent } from "./firebase";
import { logProductEvent } from "./productAnalytics";

describe("product analytics", () => {
  it("fires the paywall events without emails, names, or uids", () => {
    logProductEvent("signin_completed", { method: "password", email: "ada@example.com", uid: "user-1" });
    logProductEvent("demo_started");
    logProductEvent("paywall_viewed");
    logProductEvent("checkout_started");
    logProductEvent("interview_completed");
    expect(logAnalyticsEvent).toHaveBeenCalledWith("signin_completed", { method: "password" });
    expect(logAnalyticsEvent).toHaveBeenCalledWith("demo_started", undefined);
    expect(logAnalyticsEvent).toHaveBeenCalledWith("checkout_started", undefined);
    const serialized = JSON.stringify(vi.mocked(logAnalyticsEvent).mock.calls);
    expect(serialized).not.toMatch(/ada@example.com|user-1/);
  });
});
