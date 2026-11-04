import { describe, expect, it } from "vitest";
import {
  canUseLiveChat,
  canUseLiveInterview,
  interpretCheckoutResponse,
  phaseAfterUnlock,
  resolveSurface,
} from "./productAccess";

describe("product surface", () => {
  const base = {
    authReady: true,
    signedIn: false,
    paid: false,
    legacy: false,
    hasSavedResults: false,
    view: null,
    canceled: false,
  };

  it("shows the demo to a signed-out visitor and the paywall after cancel", () => {
    expect(resolveSurface(base)).toBe("demo");
    expect(resolveSurface({ ...base, canceled: true })).toBe("paywall");
    expect(resolveSurface({ ...base, view: "paywall" })).toBe("paywall");
    expect(resolveSurface({ ...base, authReady: false })).toBe("demo");
    expect(resolveSurface({ ...base, authReady: false, view: "paywall" })).toBe("paywall");
    expect(resolveSurface({ ...base, authReady: false, view: "app" })).toBe("loading");
  });

  it("skips the paywall for a paid account and keeps legacy results viewable", () => {
    expect(resolveSurface({ ...base, signedIn: true, paid: true })).toBe("app");
    expect(resolveSurface({ ...base, signedIn: true, paid: true, view: "paywall" })).toBe("app");
    expect(resolveSurface({
      ...base,
      signedIn: true,
      legacy: true,
      hasSavedResults: true,
    })).toBe("app");
    expect(resolveSurface({ ...base, signedIn: true, legacy: true, hasSavedResults: false })).toBe("demo");
    expect(resolveSurface({ ...base, signedIn: true, view: "app" })).toBe("paywall");
  });

  it("continues checkout only after a verified sign-in", () => {
    expect(phaseAfterUnlock({ signedIn: false, emailVerified: false })).toBe("signin");
    expect(phaseAfterUnlock({ signedIn: true, emailVerified: false })).toBe("verify");
    expect(phaseAfterUnlock({ signedIn: true, emailVerified: true })).toBe("checkout");
    expect(interpretCheckoutResponse(403, "email_not_verified").phase).toBe("verify");
    expect(interpretCheckoutResponse(409, "already_entitled").phase).toBe("app");
    expect(interpretCheckoutResponse(500, null)).toMatchObject({ phase: "paywall" });
  });

  it("agrees that live interview and live chat both need a purchase", () => {
    expect(canUseLiveInterview({ paid: false, remaining: 2, inProgress: false })).toBe(false);
    expect(canUseLiveInterview({ paid: true, remaining: 0, inProgress: false })).toBe(false);
    expect(canUseLiveInterview({ paid: true, remaining: 0, inProgress: true })).toBe(true);
    expect(canUseLiveInterview({ paid: true, remaining: 1, inProgress: false })).toBe(true);
    expect(canUseLiveChat(false)).toBe(false);
    expect(canUseLiveChat(true)).toBe(true);
  });
});
