/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

/** The return page only needs to know that a person is signed in. */
export type CheckoutAuthUser = {
  uid: string;
};

/**
 * `ready` resolves after Firebase has restored a persisted session, or
 * confirmed there isn't one. `subscribe` then reports sign-in and sign-out.
 */
export type CheckoutAuthGate = {
  ready: () => Promise<void>;
  subscribe: (listener: (user: CheckoutAuthUser | null) => void) => () => void;
};

export function createFirebaseCheckoutAuthGate(): CheckoutAuthGate {
  return {
    ready() {
      return auth.authStateReady();
    },
    subscribe(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user ? { uid: user.uid } : null);
      });
    },
  };
}

export const checkoutAuthGate = createFirebaseCheckoutAuthGate();
