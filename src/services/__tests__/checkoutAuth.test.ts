/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  authStateReady: vi.fn(async () => {}),
  currentUser: null as { uid: string } | null,
}));

const onAuthStateChanged = vi.hoisted(() =>
  vi.fn((_auth: object, _next: (user: { uid: string } | null) => void) => () => {})
);

vi.mock("../firebase", () => ({
  auth: authState,
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged,
}));

import { checkoutAuthGate } from "../checkoutAuth";

describe("checkout auth gate", () => {
  beforeEach(() => {
    authState.authStateReady.mockClear();
    onAuthStateChanged.mockClear();
  });

  it("waits for authStateReady and forwards later sign-in", async () => {
    await checkoutAuthGate.ready();
    expect(authState.authStateReady).toHaveBeenCalledTimes(1);

    const listener = vi.fn();
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValueOnce(unsubscribe);
    const stop = checkoutAuthGate.subscribe(listener);
    expect(onAuthStateChanged).toHaveBeenCalledWith(authState, expect.any(Function));

    const forward = onAuthStateChanged.mock.calls[0][1] as (user: { uid: string } | null) => void;
    forward({ uid: "ada" });
    forward(null);
    expect(listener).toHaveBeenNthCalledWith(1, { uid: "ada" });
    expect(listener).toHaveBeenNthCalledWith(2, null);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
