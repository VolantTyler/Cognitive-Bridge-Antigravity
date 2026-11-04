import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsParams } from "./analyticsSanitize";

describe("analytics params", () => {
  it("keeps method and drops emails, names, and uids", () => {
    expect(sanitizeAnalyticsParams({
      method: "google",
      email: "ada@example.com",
      name: "Ada",
      uid: "user-1",
      user_id: "user-1",
      note: "hello@hidden.test",
    })).toEqual({ method: "google" });
  });

  it("drops nothing when the event has no params", () => {
    expect(sanitizeAnalyticsParams(undefined)).toBeUndefined();
  });
});
