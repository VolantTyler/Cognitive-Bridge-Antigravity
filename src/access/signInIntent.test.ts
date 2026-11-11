import { describe, expect, it, vi } from "vitest";
import { openSignInWithoutPurchase } from "./signInIntent";

describe("openSignInWithoutPurchase", () => {
  it("clears purchase intent before opening the sign-in panel", () => {
    const purchaseIntent = { current: true };
    const openPanel = vi.fn();
    openSignInWithoutPurchase(purchaseIntent, openPanel);
    expect(purchaseIntent.current).toBe(false);
    expect(openPanel).toHaveBeenCalledOnce();
  });
});
