"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeInterview = exports.reserveInterviewSlot = exports.accessStatus = exports.stripeWebhook = exports.checkoutStatus = exports.restorePurchase = exports.createCheckout = exports.judgeProxy = exports.chatProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const genai_1 = require("@google/genai");
const cors_1 = require("./cors");
const chatHandler_1 = require("./chatHandler");
const judgeHandler_1 = require("./judgeHandler");
const gate_1 = require("./gate");
const guard_1 = require("./guard");
const interviewStore_1 = require("./interviewStore");
const interviewHttp_1 = require("./interviewHttp");
const params_2 = require("./params");
const adminStore_1 = require("./adminStore");
const auth_1 = require("./auth");
const checkoutConfig_1 = require("./checkoutConfig");
const checkoutHttp_1 = require("./checkoutHttp");
const checkoutStore_1 = require("./checkoutStore");
const stripeGateway_1 = require("./stripeGateway");
const ai = new genai_1.GoogleGenAI({
    vertexai: true,
    project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID,
    location: "us-central1",
});
const cors = (0, cors_1.allowedCorsOrigins)();
async function logUsage(record) {
    try {
        await (0, adminStore_1.writeUsageRecord)(record);
    }
    catch {
        console.error("usage_server write failed");
    }
    try {
        await (0, adminStore_1.addDailyCostFromUsage)(record);
    }
    catch {
        console.error("daily cost increment failed");
    }
}
function guardDeps() {
    return (0, guard_1.defaultGuardDeps)({ config: () => (0, params_2.loadGateConfig)() });
}
exports.chatProxy = (0, https_1.onRequest)({ cors, timeoutSeconds: 120 }, async (req, res) => {
    const deps = guardDeps();
    await (0, chatHandler_1.handleChat)(req, res, {
        guard: (incoming) => (0, guard_1.guardChat)(incoming, deps),
        ai: ai,
        logUsage,
        markInterviewStarted: async (ctx) => {
            if (!ctx.uid || !(0, gate_1.isInterviewFeature)(ctx.feature))
                return;
            await (0, interviewStore_1.markInterviewStarted)(ctx.uid);
        },
    });
});
exports.judgeProxy = (0, https_1.onRequest)({ cors, timeoutSeconds: 30 }, async (req, res) => {
    const deps = guardDeps();
    await (0, judgeHandler_1.handleJudge)(req, res, {
        guard: (incoming) => (0, guard_1.guardJudge)(incoming, deps),
        fetchImpl: fetch,
        apiKey: process.env.TYPESAFE_API_KEY,
        logUsage,
    });
});
// Test-mode keys only. Values live in Secret Manager, not in the repo.
const stripeSecretKey = (0, params_1.defineSecret)("STRIPE_SECRET_KEY");
const stripeWebhookSecret = (0, params_1.defineSecret)("STRIPE_WEBHOOK_SECRET");
function checkoutHttpDeps() {
    return {
        config: () => (0, checkoutConfig_1.loadCheckoutConfig)(),
        secretKey: () => stripeSecretKey.value(),
        webhookSecret: () => stripeWebhookSecret.value(),
        store: (0, checkoutStore_1.createFirestoreBillingStore)(),
        verifyIdToken: auth_1.verifyIdTokenWithAdmin,
        verifyAppCheck: adminStore_1.verifyAppCheckToken,
        enforceAppCheck: () => (0, params_2.loadGateConfig)().enforceAppCheck,
        now: () => Date.now(),
        gateway: () => (0, stripeGateway_1.createStripeGateway)(stripeSecretKey.value()),
        logger: (0, checkoutHttp_1.productionCheckoutLogger)(),
    };
}
exports.createCheckout = (0, https_1.onRequest)({
    cors,
    secrets: [stripeSecretKey],
    timeoutSeconds: 30,
}, (req, res) => (0, checkoutHttp_1.handleCreateCheckout)(req, res, checkoutHttpDeps()));
exports.restorePurchase = (0, https_1.onRequest)({
    cors,
    secrets: [stripeSecretKey],
    timeoutSeconds: 60,
}, (req, res) => (0, checkoutHttp_1.handleRestorePurchase)(req, res, checkoutHttpDeps()));
exports.checkoutStatus = (0, https_1.onRequest)({
    cors,
    timeoutSeconds: 15,
}, (req, res) => (0, checkoutHttp_1.handleCheckoutStatus)(req, res, checkoutHttpDeps()));
exports.stripeWebhook = (0, https_1.onRequest)({
    secrets: [stripeSecretKey, stripeWebhookSecret],
    timeoutSeconds: 60,
}, (req, res) => (0, checkoutHttp_1.handleStripeWebhook)(req, res, checkoutHttpDeps()));
function interviewHttpDeps() {
    return {
        verifyIdToken: auth_1.verifyIdTokenWithAdmin,
        verifyAppCheck: adminStore_1.verifyAppCheckToken,
        enforceAppCheck: () => (0, params_2.loadGateConfig)().enforceAppCheck,
        now: () => Date.now(),
        readAccess: (uid) => (0, interviewStore_1.readAccessView)(uid),
        reserve: (uid, now) => (0, interviewStore_1.reserveInterviewSlot)(uid, now),
        complete: (uid, reservationId, now) => (0, interviewStore_1.completeInterviewSlot)(uid, reservationId, now),
    };
}
exports.accessStatus = (0, https_1.onRequest)({ cors, timeoutSeconds: 15 }, (req, res) => {
    return (0, interviewHttp_1.handleAccessStatus)(req, res, interviewHttpDeps());
});
exports.reserveInterviewSlot = (0, https_1.onRequest)({ cors, timeoutSeconds: 15 }, (req, res) => {
    return (0, interviewHttp_1.handleReserveInterview)(req, res, interviewHttpDeps());
});
exports.completeInterview = (0, https_1.onRequest)({ cors, timeoutSeconds: 15 }, (req, res) => {
    return (0, interviewHttp_1.handleCompleteInterview)(req, res, interviewHttpDeps());
});
//# sourceMappingURL=index.js.map