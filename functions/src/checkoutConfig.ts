import { defineString } from "firebase-functions/params";
import { GateError } from "./gate";

/**
 * Stripe test-mode checkout configuration.
 *
 * Secret Manager names (defineSecret in index.ts, never commit values):
 * - STRIPE_SECRET_KEY — test secret key only (sk_test_…)
 * - STRIPE_WEBHOOK_SECRET — signing secret for the stripeWebhook endpoint
 *
 * Params (not secrets): STRIPE_PRICE_ID, APP_BASE_URL, PAYMENTS_ENABLED,
 * STRIPE_MANAGED_PAYMENTS, STRIPE_AUTOMATIC_TAX.
 * The charged amount lives on the Stripe Price, not in this repo.
 */

export const STRIPE_SECRET_KEY_NAME = "STRIPE_SECRET_KEY";
export const STRIPE_WEBHOOK_SECRET_NAME = "STRIPE_WEBHOOK_SECRET";

/** One purchase: 1 interview + 1 retake. The interview counter itself is a later PR. */
export const INTERVIEWS_ALLOWED = 2;

export const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 15_000;

/**
 * Terms page has no displayed last-updated line. This is the date of the
 * last edit to that page (LegalPages.tsx, 2026-11-09). Bump it when the
 * Terms text changes. The client must send the same value.
 */
export const TERMS_VERSION = "2026-11-09";

export const CHECKOUT_CONSENT_REQUIRED =
  "Please agree to the Terms and confirm you are 18 or older.";

const stripePriceId = defineString("STRIPE_PRICE_ID", {
  default: "",
  description: "Stripe Price ID for the one-time purchase. Test-mode price until launch.",
});

const appBaseUrl = defineString("APP_BASE_URL", {
  default: "https://cognitive-bridge-ai.web.app",
  description: "Public https origin. Terms URL is ${APP_BASE_URL}/terms. Must match the Stripe Dashboard terms URL.",
});

const paymentsEnabled = defineString("PAYMENTS_ENABLED", {
  default: "false",
  description: "When false, createCheckout refuses new sessions. Webhooks still run. Rollback switch.",
});

const managedPayments = defineString("STRIPE_MANAGED_PAYMENTS", {
  default: "false",
  description: "When true, Checkout sets managed_payments.enabled and does not set automatic_tax or shipping. When false, Checkout sets managed_payments.enabled to false.",
});

const automaticTax = defineString("STRIPE_AUTOMATIC_TAX", {
  default: "false",
  description: "Plain Stripe Tax only. Ignored when STRIPE_MANAGED_PAYMENTS is true.",
});

export interface CheckoutConfig {
  priceId: string;
  baseUrl: string;
  paymentsEnabled: boolean;
  managedPayments: boolean;
  automaticTax: boolean;
}

function paramOrEnv(envValue: string | undefined, read: () => string, fallback: string): string {
  if (envValue !== undefined) return envValue;
  try {
    return read();
  } catch {
    return fallback;
  }
}

function parseFlag(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

export function loadCheckoutConfig(env: NodeJS.ProcessEnv = process.env): CheckoutConfig {
  return {
    priceId: paramOrEnv(env.STRIPE_PRICE_ID, () => stripePriceId.value(), "").trim(),
    baseUrl: paramOrEnv(env.APP_BASE_URL, () => appBaseUrl.value(), "https://cognitive-bridge-ai.web.app").trim(),
    paymentsEnabled: parseFlag(paramOrEnv(env.PAYMENTS_ENABLED, () => paymentsEnabled.value(), "false"), false),
    managedPayments: parseFlag(
      paramOrEnv(env.STRIPE_MANAGED_PAYMENTS, () => managedPayments.value(), "false"),
      false
    ),
    automaticTax: parseFlag(paramOrEnv(env.STRIPE_AUTOMATIC_TAX, () => automaticTax.value(), "false"), false),
  };
}

/** True only for a test-mode secret key. Live keys are refused in this PR. */
export function isStripeTestKey(secretKey: string): boolean {
  return secretKey.startsWith("sk_test_");
}

export function assertStripeTestKey(secretKey: string): void {
  if (!isStripeTestKey(secretKey)) {
    throw new GateError(503, "test_mode_only", "Checkout is in test mode only.");
  }
}

export function termsUrlForBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/terms`;
  if (!/^https:\/\/[^\s()]+\/terms$/.test(url)) {
    throw new GateError(503, "payments_not_configured", "Checkout is not open yet.");
  }
  return url;
}

/**
 * Replaces Stripe's default terms checkbox sentence.
 * Stripe shows this in place of its own agreement text. Keep a markdown terms link.
 * The 18+ clause is additive. It does not say sales are final or promise a refund.
 */
export function termsAcceptanceMessage(termsUrl: string): string {
  return `I agree to the [Terms](${termsUrl}) and I am 18 or older.`;
}

export function checkoutIdempotencyKey(uid: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / CHECKOUT_IDEMPOTENCY_WINDOW_MS);
  return `cb-checkout-${uid}-${bucket}`;
}

/** Rejects a checkout body that did not accept the current Terms and the 18+ attestation. */
export function assertCheckoutConsent(body: unknown): void {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (record?.termsAccepted !== true || record.termsVersion !== TERMS_VERSION) {
    throw new GateError(400, "terms_not_accepted", CHECKOUT_CONSENT_REQUIRED);
  }
}

export interface CheckoutSessionCreateParams {
  mode: "payment";
  line_items: Array<{ price: string; quantity: number }>;
  client_reference_id: string;
  billing_address_collection: "required";
  consent_collection: { terms_of_service: "required" };
  custom_text?: { terms_of_service_acceptance: { message: string } };
  success_url: string;
  cancel_url: string;
  metadata: { uid: string };
  payment_intent_data: { metadata: { uid: string }; receipt_email?: string };
  customer_email?: string;
  managed_payments?: { enabled: boolean };
  automatic_tax?: { enabled: true };
}

export function buildCheckoutSessionCreateParams(input: {
  uid: string;
  email: string | null;
  priceId: string;
  baseUrl: string;
  managedPayments: boolean;
  automaticTax: boolean;
}): CheckoutSessionCreateParams {
  const termsUrl = termsUrlForBase(input.baseUrl);
  const base = input.baseUrl.replace(/\/$/, "");
  const params: CheckoutSessionCreateParams = {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.uid,
    // Collects the billing country. It does not restrict which country.
    // shipping_address_collection is for physical goods and is intentionally omitted.
    billing_address_collection: "required",
    consent_collection: { terms_of_service: "required" },
    success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancel`,
    metadata: { uid: input.uid },
    payment_intent_data: { metadata: { uid: input.uid } },
  };
  if (input.email && input.email.includes("@")) {
    params.customer_email = input.email;
  }
  if (input.managedPayments) {
    // Managed Payments calculates tax and sends the receipt itself.
    // It rejects custom_text and payment_intent_data.receipt_email.
    // The one-time unsupported list does not include billing_address_collection,
    // client_reference_id, metadata, payment_intent_data.metadata, or
    // consent_collection.terms_of_service, so those stay.
    params.managed_payments = { enabled: true };
  } else {
    // New accounts turn Managed Payments on at the account level. Omitting the
    // field lets that default win, and Stripe then rejects custom_text.
    params.custom_text = {
      terms_of_service_acceptance: { message: termsAcceptanceMessage(termsUrl) },
    };
    if (input.email && input.email.includes("@")) {
      params.payment_intent_data.receipt_email = input.email;
    }
    params.managed_payments = { enabled: false };
    if (input.automaticTax) {
      params.automatic_tax = { enabled: true };
    }
  }
  return params;
}

export function isSafeStripeQueryUid(uid: string): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(uid);
}
