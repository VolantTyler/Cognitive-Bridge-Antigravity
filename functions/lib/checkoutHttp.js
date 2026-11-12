"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productionCheckoutLogger = productionCheckoutLogger;
exports.handleCreateCheckout = handleCreateCheckout;
exports.handleRestorePurchase = handleRestorePurchase;
exports.handleCheckoutStatus = handleCheckoutStatus;
exports.handleStripeWebhook = handleStripeWebhook;
const auth_1 = require("./auth");
const gate_1 = require("./gate");
const checkoutConfig_1 = require("./checkoutConfig");
const checkoutEvents_1 = require("./checkoutEvents");
const checkoutTypes_1 = require("./checkoutTypes");
const stripeGateway_1 = require("./stripeGateway");
const consoleLogger = {
    info(message) {
        console.info(message);
    },
    error(message, details) {
        if (details) {
            console.error(JSON.stringify({ message, ...details }));
            return;
        }
        console.error(message);
    },
};
function productionCheckoutLogger() {
    return consoleLogger;
}
const CHECKOUT_OPEN_FAILED = "Couldn't open checkout. You haven't been charged.";
/**
 * Client `code` values for Stripe failures. Derived from the error type only.
 * Stripe's own `code` (resource_missing, card_declined, …) stays in the log.
 */
const STRIPE_CLIENT_CODES = {
    StripeInvalidRequestError: "stripe_invalid_request",
    invalid_request_error: "stripe_invalid_request",
    StripeCardError: "stripe_card",
    card_error: "stripe_card",
    StripeRateLimitError: "stripe_rate_limit",
    rate_limit_error: "stripe_rate_limit",
    StripeAuthenticationError: "stripe_authentication",
    authentication_error: "stripe_authentication",
    StripePermissionError: "stripe_permission",
    StripeAPIError: "stripe_api",
    api_error: "stripe_api",
    StripeConnectionError: "stripe_connection",
    StripeIdempotencyError: "stripe_idempotency",
    idempotency_error: "stripe_idempotency",
    StripeSignatureVerificationError: "stripe_signature",
    StripeInvalidGrantError: "stripe_invalid_grant",
    invalid_grant: "stripe_invalid_grant",
    StripeError: "stripe_error",
};
const STRIPE_CLASS_TYPE = /^Stripe[A-Za-z0-9]*Error$/;
const SECRET_TEXT = /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+/g;
function stringField(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function publicText(value) {
    return value.replace(SECRET_TEXT, "[redacted]");
}
function isStripeFailure(error) {
    if (!error || typeof error !== "object")
        return false;
    const type = error.type;
    const rawType = error.rawType;
    if (typeof type === "string" && (STRIPE_CLASS_TYPE.test(type) || STRIPE_CLIENT_CODES[type]))
        return true;
    return typeof rawType === "string" && Boolean(STRIPE_CLIENT_CODES[rawType]);
}
function clientCodeForCheckoutFailure(error) {
    if (!isStripeFailure(error))
        return "checkout_failed";
    const type = stringField(error.type);
    if (type && STRIPE_CLIENT_CODES[type])
        return STRIPE_CLIENT_CODES[type];
    const rawType = stringField(error.rawType);
    if (rawType && STRIPE_CLIENT_CODES[rawType])
        return STRIPE_CLIENT_CODES[rawType];
    return "stripe_error";
}
/** Names only. Values such as email, price, and secret keys are never copied. */
function stripeFailureLog(error) {
    const stripe = {
        type: stringField(error.type) ?? stringField(error.rawType) ?? "StripeError",
        message: typeof error.message === "string" ? publicText(error.message) : "",
    };
    const code = stringField(error.code);
    if (code)
        stripe.code = publicText(code);
    const param = stringField(error.param);
    if (param)
        stripe.param = publicText(param);
    if (typeof error.statusCode === "number" && Number.isFinite(error.statusCode)) {
        stripe.statusCode = error.statusCode;
    }
    const requestId = stringField(error.requestId);
    if (requestId)
        stripe.requestId = publicText(requestId);
    const declineCode = stringField(error.decline_code);
    if (declineCode)
        stripe.decline_code = publicText(declineCode);
    return stripe;
}
function plainFailureLog(error) {
    if (error instanceof Error) {
        const body = { name: error.name, message: publicText(error.message) };
        if (typeof error.stack === "string" && error.stack.length > 0)
            body.stack = publicText(error.stack);
        return body;
    }
    if (typeof error === "string" && error.length > 0)
        return { name: "Error", message: publicText(error) };
    return { name: "Error", message: "Checkout failed" };
}
function checkoutFailureDetails(error, built) {
    const details = {};
    if (built) {
        details.branch = built.managedPayments ? "managedPayments on" : "managedPayments off";
        details.paramKeys = built.paramKeys;
    }
    if (isStripeFailure(error))
        details.stripe = stripeFailureLog(error);
    else
        details.error = plainFailureLog(error);
    return details;
}
function logCreateCheckoutFailure(logger, error, built) {
    logger.error("createCheckout failed", checkoutFailureDetails(error, built));
}
function sendGate(res, error) {
    res.status(error.status).json({ error: error.message, code: error.code });
}
function sendFailure(res, status, code, error) {
    res.status(status).json({ error, code });
}
async function requireCheckoutUser(req, deps) {
    if (deps.enforceAppCheck()) {
        const token = (0, gate_1.readHeader)(req, "x-firebase-appcheck") ?? (0, gate_1.readHeader)(req, "X-Firebase-AppCheck");
        if (!token)
            throw (0, gate_1.appCheckError)();
        try {
            await deps.verifyAppCheck(token);
        }
        catch {
            throw (0, gate_1.appCheckError)();
        }
    }
    const user = await (0, auth_1.verifyBearerToken)((0, gate_1.readHeader)(req, "authorization"), deps.verifyIdToken);
    return (0, auth_1.requireEmailVerified)(user);
}
function queryString(req, name) {
    const value = req.query?.[name];
    if (Array.isArray(value))
        return typeof value[0] === "string" ? value[0] : null;
    return typeof value === "string" && value.length > 0 ? value : null;
}
function eventDeps(deps, refunds) {
    return { store: deps.store, logger: deps.logger, refunds };
}
async function handleCreateCheckout(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendFailure(res, 405, "method_not_allowed", "POST required.");
        return;
    }
    let built = null;
    try {
        const user = await requireCheckoutUser(req, deps);
        const config = deps.config();
        if (!config.paymentsEnabled || !config.priceId) {
            throw new gate_1.GateError(503, "payments_disabled", "Checkout is not open yet.");
        }
        (0, checkoutConfig_1.assertStripeTestKey)(deps.secretKey());
        const entitlement = await deps.store.readEntitlement(user.uid);
        if (entitlement?.paid) {
            throw new gate_1.GateError(409, "already_entitled", "This account already has access.");
        }
        (0, checkoutConfig_1.assertCheckoutConsent)(req.body);
        const params = (0, checkoutConfig_1.buildCheckoutSessionCreateParams)({
            uid: user.uid,
            email: user.email,
            priceId: config.priceId,
            baseUrl: config.baseUrl,
            managedPayments: config.managedPayments,
            automaticTax: config.automaticTax,
        });
        built = {
            managedPayments: config.managedPayments,
            paramKeys: Object.keys(params).sort(),
        };
        const session = await deps.gateway().createSession(params, (0, checkoutConfig_1.checkoutIdempotencyKey)(user.uid, deps.now()));
        if (!session.url) {
            logCreateCheckoutFailure(deps.logger, new Error("Checkout session missing url"), built);
            throw new gate_1.GateError(502, "checkout_unavailable", CHECKOUT_OPEN_FAILED);
        }
        await deps.store.writeCheckoutConsent({
            uid: user.uid,
            termsVersion: checkoutConfig_1.TERMS_VERSION,
            attested18OrOlder: true,
            sessionId: session.id,
        });
        await deps.store.writeCheckoutRecord({
            sessionId: session.id,
            uid: user.uid,
            paymentIntentId: null,
            billingCountry: null,
            termsAccepted: false,
            outcome: "open",
            manualRefundRequired: false,
            needsManualReview: false,
            amount: null,
            currency: null,
        });
        res.status(200).json({ url: session.url });
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        logCreateCheckoutFailure(deps.logger, error, built);
        sendFailure(res, 502, clientCodeForCheckoutFailure(error), CHECKOUT_OPEN_FAILED);
    }
}
async function handleRestorePurchase(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendFailure(res, 405, "method_not_allowed", "POST required.");
        return;
    }
    try {
        const user = await requireCheckoutUser(req, deps);
        (0, checkoutConfig_1.assertStripeTestKey)(deps.secretKey());
        const gateway = deps.gateway();
        const result = await (0, checkoutEvents_1.restorePurchaseForUser)(user.uid, {
            ...eventDeps(deps, gateway),
            sessions: gateway,
        });
        res.status(200).json(result);
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        deps.logger.error("restorePurchase failed");
        sendFailure(res, 500, "restore_failed", "We couldn't confirm your access.");
    }
}
async function handleCheckoutStatus(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
        sendFailure(res, 405, "method_not_allowed", "GET required.");
        return;
    }
    try {
        const user = await requireCheckoutUser(req, deps);
        const sessionId = queryString(req, "session_id");
        if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
            sendFailure(res, 400, "bad_request", "Missing checkout session.");
            return;
        }
        const record = await deps.store.readCheckoutRecord(sessionId);
        if (record && record.uid !== user.uid) {
            sendFailure(res, 404, "not_found", "We couldn't match this payment to your account.");
            return;
        }
        const entitlement = await deps.store.readEntitlement(user.uid);
        const sameSession = entitlement?.sessionId === sessionId && entitlement.paid;
        res.status(200).json({
            status: (0, checkoutTypes_1.clientStatusForRecord)(record, sameSession),
        });
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        deps.logger.error("checkoutStatus failed");
        sendFailure(res, 500, "status_failed", "We couldn't confirm your access.");
    }
}
async function handleStripeWebhook(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendFailure(res, 405, "method_not_allowed", "POST required.");
        return;
    }
    const signature = (0, gate_1.readHeader)(req, "stripe-signature");
    if (!signature || !req.rawBody) {
        sendFailure(res, 400, "invalid_signature", "Invalid Stripe signature.");
        return;
    }
    let event;
    try {
        const construct = deps.constructEvent ?? stripeGateway_1.constructStripeEvent;
        event = construct(req.rawBody, signature, deps.webhookSecret());
    }
    catch {
        sendFailure(res, 400, "invalid_signature", "Invalid Stripe signature.");
        return;
    }
    try {
        const secretKey = deps.secretKey();
        const gateway = (0, checkoutConfig_1.isStripeTestKey)(secretKey) ? deps.gateway() : null;
        await (0, checkoutEvents_1.handleStripeEvent)(event, eventDeps(deps, {
            async refundNonUs(paymentIntentId, sessionId) {
                if (!gateway) {
                    const error = new Error("not_test_mode");
                    throw Object.assign(error, { code: "not_test_mode" });
                }
                await gateway.refundNonUs(paymentIntentId, sessionId);
            },
        }));
        res.status(200).json({ received: true });
    }
    catch {
        sendFailure(res, 500, "webhook_failed", "Webhook handler failed.");
    }
}
//# sourceMappingURL=checkoutHttp.js.map