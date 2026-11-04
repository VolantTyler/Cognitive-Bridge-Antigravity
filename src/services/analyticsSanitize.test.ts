import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsParams } from "./analyticsSanitize";

describe("analytics params", () => {
  it("keeps method and drops email, name, id, and message text", () => {
    expect(sanitizeAnalyticsParams({
      method: "google",
      email: "ada@example.com",
      name: "Ada",
      displayName: "Ada",
      id: "user-1",
      uid: "user-1",
      user_id: "user-1",
      userId: "user-1",
      message: "hello from the interview",
      content: "chat text",
      prompt: "how should I prepare",
      reply: "start by reading",
      note: "hello@hidden.test",
    })).toEqual({ method: "google" });
  });

  it("drops nothing when the event has no params", () => {
    expect(sanitizeAnalyticsParams(undefined)).toBeUndefined();
  });
});
