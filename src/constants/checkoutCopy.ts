/**
 * Checkout return copy.
 * The non-US refunded paragraph is Charlie's wording. The refund-failed paragraph
 * must not say a refund happened.
 */

export const SUPPORT_EMAIL = "cos-stahl+cbsupport@mail.grokbot.com";

/** Lead-in on the footer, paywall, and checkout return. Keep this wording. */
export const NEED_HELP_OR_REFUND = "Need help or a refund?";

export const REFUND_REQUEST_HEADING = "How to request a refund";

/** Follows "Email <support>" on the Terms page. Does not change the all-sales-final policy. */
export const REFUND_REQUEST_INSTRUCTIONS =
  "to request a refund. Include your account email and the date of your purchase.";

export const NON_US_HEADING = "We couldn't complete your purchase";

export const NON_US_REFUNDED_BODY =
  `Cognitive Bridge is only available in the US right now, so access wasn't turned on. We're refunding your payment. If you don't see the refund, contact ${SUPPORT_EMAIL}.`;

export const NON_US_REFUND_FAILED_BODY =
  `Cognitive Bridge is only available in the US right now, so access wasn't turned on. A refund has not been confirmed. Contact ${SUPPORT_EMAIL} so we can look up the payment.`;

export const BACK_TO_COGNITIVE_BRIDGE = "Back to Cognitive Bridge";

export const CHECKOUT_CANCELED = "Checkout canceled. You weren't charged.";

export const CHECKOUT_CONFIRMED = "Payment confirmed.";

export const CHECKOUT_CONFIRMING = "Confirming payment…";

export const CHECKOUT_TIMEOUT = "Your payment is still being confirmed.";

export const CHECKOUT_SIGN_IN = "Sign in to confirm this payment.";

export const CHECKOUT_UNMATCHED =
  `We couldn't match this payment to your account. Contact ${SUPPORT_EMAIL}.`;

export const CHECKOUT_NOT_GRANTED =
  `We couldn't turn on access for this payment. Contact ${SUPPORT_EMAIL}.`;

export const CHECKOUT_RESTORE_FAILED = "We couldn't confirm your access.";

export const RESTORE_PURCHASE = "Restore purchase";

export type CheckoutViewStatus =
  | "pending"
  | "paid"
  | "non_us_refunded"
  | "non_us_refund_failed"
  | "terms_not_accepted"
  | "country_unconfirmed"
  | "not_found"
  | "timeout"
  | "signin"
  | "cancel";

export class CheckoutClientError extends Error {
  readonly code: "signed_out" | "not_found" | "failed";

  constructor(code: "signed_out" | "not_found" | "failed") {
    super(code);
    this.name = "CheckoutClientError";
    this.code = code;
  }
}
