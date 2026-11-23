import { defineString } from "firebase-functions/params";
import { GateError } from "./gate";

/**
 * Stripe live-mode checkout configuration.
 *
 * Secret Manager names (defineSecret in index.ts, never commit values):
 * - STRIPE_SECRET_KEY — live secret or restricted key (sk_live_ or rk_live_)
 * - STRIPE_WEBHOOK_SECRET — live signing secret for the stripeWebhook endpoint
 *
 * Params (not secrets): STRIPE_PRICE_ID, APP_BASE_URL, PAYMENTS_ENABLED,
 * STRIPE_MANAGED_PAYMENTS, STRIPE_AUTOMATIC_TAX.
 * The charged amount lives on the Stripe Price, not in this repo.
 */

/** Refused if STRIPE_PRICE_ID is set back to this placeholder. Not chargeable. */
export const LIVE_PRICE_ID_PLACEHOLDER = "price_REPLACE_ME_AFTER_CREATING_LIVE_6_DOLLAR_PRICE";

/** Sandbox Price previously committed in functions/.env. Refused so a live key cannot charge it. */
export const RETIRED_TEST_PRICE_ID = "price_1UadSFEW8GloDNOQc0mhRCHU";

/** Stripe Price ids are `price_` plus one alphanumeric token. */
const CHARGEABLE_PRICE_ID = /^price_[A-Za-z0-9]{14,}$/;

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
  description: "Live Stripe Price ID for the one-time purchase. Amount is on the Price. Placeholder and test-mode ids are refused.",
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
  default: "true",
  description: "Live checkout sets managed_payments.enabled and does not set automatic_tax or payment_intent_data.receipt_email. Set false only to opt out.",
});

const automaticTax = defineString("STRIPE_AUTOMATIC_TAX", {
  default: "false",
  description: "Plain Stripe Tax only. Leave false for live checkout. Ignored when STRIPE_MANAGED_PAYMENTS is true, which rejects automatic_tax.",
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
      paramOrEnv(env.STRIPE_MANAGED_PAYMENTS, () => managedPayments.value(), "true"),
      true
    ),
    automaticTax: parseFlag(paramOrEnv(env.STRIPE_AUTOMATIC_TAX, () => automaticTax.value(), "false"), false),
  };
}

/** True for a live secret key or a live restricted key. Test keys are refused. */
export function isStripeLiveKey(secretKey: string): boolean {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
}

export function assertStripeLiveKey(secretKey: string): void {
  if (!isStripeLiveKey(secretKey)) {
    throw new GateError(503, "live_mode_only", "Checkout is in live mode only.");
  }
}

/** True when this id can be sent to Stripe in live mode. */
export function isChargeableLivePriceId(priceId: string): boolean {
  const id = priceId.trim();
  if (id === LIVE_PRICE_ID_PLACEHOLDER || id === RETIRED_TEST_PRICE_ID) return false;
  if (id.toUpperCase().includes("REPLACE")) return false;
  return CHARGEABLE_PRICE_ID.test(id);
}

export function assertChargeableLivePriceId(priceId: string): void {
  if (!isChargeableLivePriceId(priceId)) {
    throw new GateError(503, "payments_not_configured", "Checkout is not open yet.");
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
  // The paywall links to this origin's /terms page. Reject a base that cannot form that https URL.
  termsUrlForBase(input.baseUrl);
  const base = input.baseUrl.replace(/\/$/, "");
  const params: CheckoutSessionCreateParams = {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.uid,
    // Collects the billing country. It does not restrict which country.
    // shipping_address_collection is for physical goods and is intentionally omitted.
    billing_address_collection: "required",
    success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancel`,
    metadata: { uid: input.uid },
    payment_intent_data: { metadata: { uid: input.uid } },
  };
  if (input.email && input.email.includes("@")) {
    params.customer_email = input.email;
  }
  // Neither branch sends consent_collection or custom_text. The in-app Terms
  // and 18+ checkbox, stored by writeCheckoutConsent, is the consent of record.
  // Stripe only allows custom_text.terms_of_service_acceptance when
  // consent_collection.terms_of_service is required.
  if (input.managedPayments) {
    // Managed Payments calculates tax and sends the receipt itself.
    // It rejects payment_intent_data.receipt_email and automatic_tax.
    params.managed_payments = { enabled: true };
  } else {
    // New accounts turn Managed Payments on at the account level. Omitting the
    // field lets that default win, and Stripe then rejects receipt_email and
    // automatic_tax.
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
