"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS = exports.INTERVIEWS_ALLOWED = exports.STRIPE_WEBHOOK_SECRET_NAME = exports.STRIPE_SECRET_KEY_NAME = void 0;
exports.loadCheckoutConfig = loadCheckoutConfig;
exports.isStripeTestKey = isStripeTestKey;
exports.assertStripeTestKey = assertStripeTestKey;
exports.termsUrlForBase = termsUrlForBase;
exports.termsAcceptanceMessage = termsAcceptanceMessage;
exports.checkoutIdempotencyKey = checkoutIdempotencyKey;
exports.buildCheckoutSessionCreateParams = buildCheckoutSessionCreateParams;
exports.isSafeStripeQueryUid = isSafeStripeQueryUid;
const params_1 = require("firebase-functions/params");
const gate_1 = require("./gate");
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
exports.STRIPE_SECRET_KEY_NAME = "STRIPE_SECRET_KEY";
exports.STRIPE_WEBHOOK_SECRET_NAME = "STRIPE_WEBHOOK_SECRET";
/** One purchase: 1 interview + 1 retake. The interview counter itself is a later PR. */
exports.INTERVIEWS_ALLOWED = 2;
exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS = 15_000;
const stripePriceId = (0, params_1.defineString)("STRIPE_PRICE_ID", {
    default: "",
    description: "Stripe Price ID for the one-time purchase. Test-mode price until launch.",
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
    default: "false",
    description: "When true, Checkout sets managed_payments.enabled and does not set automatic_tax or shipping.",
});
const automaticTax = (0, params_1.defineString)("STRIPE_AUTOMATIC_TAX", {
    default: "false",
    description: "Plain Stripe Tax only. Ignored when STRIPE_MANAGED_PAYMENTS is true.",
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
        managedPayments: parseFlag(paramOrEnv(env.STRIPE_MANAGED_PAYMENTS, () => managedPayments.value(), "false"), false),
        automaticTax: parseFlag(paramOrEnv(env.STRIPE_AUTOMATIC_TAX, () => automaticTax.value(), "false"), false),
    };
}
/** True only for a test-mode secret key. Live keys are refused in this PR. */
function isStripeTestKey(secretKey) {
    return secretKey.startsWith("sk_test_");
}
function assertStripeTestKey(secretKey) {
    if (!isStripeTestKey(secretKey)) {
        throw new gate_1.GateError(503, "test_mode_only", "Checkout is in test mode only.");
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
/**
 * Replaces Stripe's default terms checkbox sentence.
 * Stripe shows this in place of its own agreement text. Keep a markdown terms link.
 * The 18+ clause is additive. It does not say sales are final or promise a refund.
 */
function termsAcceptanceMessage(termsUrl) {
    return `I agree to the [Terms](${termsUrl}) and I am 18 or older.`;
}
function checkoutIdempotencyKey(uid, nowMs) {
    const bucket = Math.floor(nowMs / exports.CHECKOUT_IDEMPOTENCY_WINDOW_MS);
    return `cb-checkout-${uid}-${bucket}`;
}
function buildCheckoutSessionCreateParams(input) {
    const termsUrl = termsUrlForBase(input.baseUrl);
    const base = input.baseUrl.replace(/\/$/, "");
    const params = {
        mode: "payment",
        line_items: [{ price: input.priceId, quantity: 1 }],
        client_reference_id: input.uid,
        // Collects the billing country. It does not restrict which country.
        // shipping_address_collection is for physical goods and is intentionally omitted.
        billing_address_collection: "required",
        consent_collection: { terms_of_service: "required" },
        custom_text: {
            terms_of_service_acceptance: { message: termsAcceptanceMessage(termsUrl) },
        },
        success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/?checkout=cancel`,
        metadata: { uid: input.uid },
        payment_intent_data: { metadata: { uid: input.uid } },
    };
    if (input.email && input.email.includes("@")) {
        params.customer_email = input.email;
        params.payment_intent_data.receipt_email = input.email;
    }
    if (input.managedPayments) {
        // Managed Payments calculates tax itself and rejects shipping collection.
        params.managed_payments = { enabled: true };
    }
    else if (input.automaticTax) {
        params.automatic_tax = { enabled: true };
    }
    return params;
}
function isSafeStripeQueryUid(uid) {
    return /^[A-Za-z0-9:_-]{1,128}$/.test(uid);
}
//# sourceMappingURL=checkoutConfig.js.map