/**
 * Nav "Sign in" opens the account panel on the current page.
 * It must not carry purchase intent, or a successful sign-in would start checkout.
 */
export function openSignInWithoutPurchase(
  purchaseIntent: { current: boolean },
  openPanel: () => void,
): void {
  purchaseIntent.current = false;
  openPanel();
}
