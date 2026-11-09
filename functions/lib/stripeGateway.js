"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.constructStripeEvent = constructStripeEvent;
exports.createStripeGateway = createStripeGateway;
const stripe_1 = __importDefault(require("stripe"));
const checkoutConfig_1 = require("./checkoutConfig");
const checkoutTypes_1 = require("./checkoutTypes");
const API_VERSION = "2026-10-28.endive";
function toPlain(value) {
    return JSON.parse(JSON.stringify(value));
}
function constructStripeEvent(rawBody, signature, webhookSecret) {
    const event = stripe_1.default.webhooks.constructEvent(rawBody, signature, webhookSecret);
    return {
        id: event.id,
        type: event.type,
        data: { object: toPlain(event.data.object) },
    };
}
function createStripeGateway(secretKey) {
    (0, checkoutConfig_1.assertStripeTestKey)(secretKey);
    const stripe = new stripe_1.default(secretKey, { apiVersion: API_VERSION });
    return {
        async createSession(params, idempotencyKey) {
            const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
            return { id: session.id, url: session.url };
        },
        async refundNonUs(paymentIntentId, sessionId) {
            await stripe.refunds.create({
                payment_intent: paymentIntentId,
                reason: "requested_by_customer",
                metadata: { reason: "non_us_billing" },
            }, { idempotencyKey: `non-us-${sessionId}` });
        },
        async retrieveSession(sessionId) {
            try {
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                return (0, checkoutTypes_1.snapshotCheckoutSession)(toPlain(session));
            }
            catch {
                return null;
            }
        },
        async findSucceededSessionIds(uid) {
            if (!(0, checkoutConfig_1.isSafeStripeQueryUid)(uid))
                return [];
            const found = await stripe.paymentIntents.search({
                query: `metadata['uid']:'${uid}' AND status:'succeeded'`,
                limit: 10,
            });
            const ids = [];
            for (const paymentIntent of found.data) {
                const sessions = await stripe.checkout.sessions.list({
                    payment_intent: paymentIntent.id,
                    limit: 1,
                });
                const session = sessions.data[0];
                if (session?.id)
                    ids.push(session.id);
            }
            return ids;
        },
    };
}
//# sourceMappingURL=stripeGateway.js.map