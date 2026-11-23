"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKOUT_CONSENT_REQUIRED = exports.TERMS_VERSION = exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS = exports.INTERVIEWS_ALLOWED = exports.STRIPE_WEBHOOK_SECRET_NAME = exports.STRIPE_SECRET_KEY_NAME = exports.RETIRED_TEST_PRICE_ID = exports.LIVE_PRICE_ID_PLACEHOLDER = void 0;
exports.loadCheckoutConfig = loadCheckoutConfig;
exports.isStripeLiveKey = isStripeLiveKey;
exports.assertStripeLiveKey = assertStripeLiveKey;
exports.isChargeableLivePriceId = isChargeableLivePriceId;
exports.assertChargeableLivePriceId = assertChargeableLivePriceId;
exports.termsUrlForBase = termsUrlForBase;
exports.checkoutIdempotencyKey = checkoutIdempotencyKey;
exports.assertCheckoutConsent = assertCheckoutConsent;
exports.buildCheckoutSessionCreateParams = buildCheckoutSessionCreateParams;
exports.isSafeStripeQueryUid = isSafeStripeQueryUid;
const params_1 = require("firebase-functions/params");
const gate_1 = require("./gate");
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
exports.LIVE_PRICE_ID_PLACEHOLDER = "price_REPLACE_ME_AFTER_CREATING_LIVE_6_DOLLAR_PRICE";
/** Sandbox Price previously committed in functions/.env. Refused so a live key cannot charge it. */
exports.RETIRED_TEST_PRICE_ID = "price_1UadSFEW8GloDNOQc0mhRCHU";
/** Stripe Price ids are `price_` plus one alphanumeric token. */
const CHARGEABLE_PRICE_ID = /^price_[A-Za-z0-9]{14,}$/;
exports.STRIPE_SECRET_KEY_NAME = "STRIPE_SECRET_KEY";
exports.STRIPE_WEBHOOK_SECRET_NAME = "STRIPE_WEBHOOK_SECRET";
/** One purchase: 1 interview + 1 retake. The interview counter itself is a later PR. */
exports.INTERVIEWS_ALLOWED = 2;
exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS = 15_000;
/**
 * Terms page has no displayed last-updated line. This is the date of the
 * last edit to that page (LegalPages.tsx, 2026-11-09). Bump it when the
 * Terms text changes. The client must send the same value.
 */
exports.TERMS_VERSION = "2026-11-09";
exports.CHECKOUT_CONSENT_REQUIRED = "Please agree to the Terms and confirm you are 18 or older.";
const stripePriceId = (0, params_1.defineString)("STRIPE_PRICE_ID", {
    default: "",
    description: "Live Stripe Price ID for the one-time purchase. Amount is on the Price. Placeholder and test-mode ids are refused.",
});
const appBaseUrl = (0, params_1.defineString)("APP_BASE_URL", {
    default: "https://cognitive-bridge-ai.web.app",
    description: "Public https origin. Terms URL is ${APP_BASE_URL}/terms. Must match the Stripe Dashboard terms URL.",
});
const paymentsEnabled = (0, params_1.defineString)("PAYMENTS_ENABLED", {
    default: "false",
    description: "When false, createCheckout refuses new sessions. Webhooks still run. Rollback switch.",
});
const managedPayments = (0, params_1.defineString)("STRIPE_MANAGED_PAYMENTS", {
    default: "true",
    description: "Live checkout sets managed_payments.enabled and does not set automatic_tax or payment_intent_data.receipt_email. Set false only to opt out.",
});
const automaticTax = (0, params_1.defineString)("STRIPE_AUTOMATIC_TAX", {
    default: "false",
    description: "Plain Stripe Tax only. Leave false for live checkout. Ignored when STRIPE_MANAGED_PAYMENTS is true, which rejects automatic_tax.",
});
function paramOrEnv(envValue, read, fallback) {
    if (envValue !== undefined)
        return envValue;
    try {
        return read();
    }
    catch {
        return fallback;
    }
}
function parseFlag(raw, fallback = false) {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const value = raw.trim().toLowerCase();
    if (value === "true" || value === "1" || value === "yes")
        return true;
    if (value === "false" || value === "0" || value === "no")
        return false;
    return fallback;
}
function loadCheckoutConfig(env = process.env) {
    return {
        priceId: paramOrEnv(env.STRIPE_PRICE_ID, () => stripePriceId.value(), "").trim(),
        baseUrl: paramOrEnv(env.APP_BASE_URL, () => appBaseUrl.value(), "https://cognitive-bridge-ai.web.app").trim(),
        paymentsEnabled: parseFlag(paramOrEnv(env.PAYMENTS_ENABLED, () => paymentsEnabled.value(), "false"), false),
        managedPayments: parseFlag(paramOrEnv(env.STRIPE_MANAGED_PAYMENTS, () => managedPayments.value(), "true"), true),
        automaticTax: parseFlag(paramOrEnv(env.STRIPE_AUTOMATIC_TAX, () => automaticTax.value(), "false"), false),
    };
}
/** True for a live secret key or a live restricted key. Test keys are refused. */
function isStripeLiveKey(secretKey) {
    return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
}
function assertStripeLiveKey(secretKey) {
    if (!isStripeLiveKey(secretKey)) {
        throw new gate_1.GateError(503, "live_mode_only", "Checkout is in live mode only.");
    }
}
/** True when this id can be sent to Stripe in live mode. */
function isChargeableLivePriceId(priceId) {
    const id = priceId.trim();
    if (id === exports.LIVE_PRICE_ID_PLACEHOLDER || id === exports.RETIRED_TEST_PRICE_ID)
        return false;
    if (id.toUpperCase().includes("REPLACE"))
        return false;
    return CHARGEABLE_PRICE_ID.test(id);
}
function assertChargeableLivePriceId(priceId) {
    if (!isChargeableLivePriceId(priceId)) {
        throw new gate_1.GateError(503, "payments_not_configured", "Checkout is not open yet.");
    }
}
function termsUrlForBase(baseUrl) {
    const base = baseUrl.replace(/\/$/, "");
    const url = `${base}/terms`;
    if (!/^https:\/\/[^\s()]+\/terms$/.test(url)) {
        throw new gate_1.GateError(503, "payments_not_configured", "Checkout is not open yet.");
    }
    return url;
}
function checkoutIdempotencyKey(uid, nowMs) {
    const bucket = Math.floor(nowMs / exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS);
    return `cb-checkout-${uid}-${bucket}`;
}
/** Rejects a checkout body that did not accept the current Terms and the 18+ attestation. */
function assertCheckoutConsent(body) {
    const record = body && typeof body === "object" && !Array.isArray(body)
        ? body
        : null;
    if (record?.termsAccepted !== true || record.termsVersion !== exports.TERMS_VERSION) {
        throw new gate_1.GateError(400, "terms_not_accepted", exports.CHECKOUT_CONSENT_REQUIRED);
    }
}
function buildCheckoutSessionCreateParams(input) {
    // The paywall links to this origin's /terms page. Reject a base that cannot form that https URL.
    termsUrlForBase(input.baseUrl);
    const base = input.baseUrl.replace(/\/$/, "");
    const params = {
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
    }
    else {
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
function isSafeStripeQueryUid(uid) {
    return /^[A-Za-z0-9:_-]{1,128}$/.test(uid);
}
//# sourceMappingURL=checkoutConfig.js.map