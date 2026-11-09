"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardChat = guardChat;
exports.guardJudge = guardJudge;
exports.defaultGuardDeps = defaultGuardDeps;
const auth_1 = require("./auth");
const interviewStore_1 = require("./interviewStore");
const modelRouter_1 = require("./modelRouter");
const gate_1 = require("./gate");
function asRecord(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
        return {};
    return body;
}
async function enforceAppCheck(req, config, deps) {
    if (!config.enforceAppCheck)
        return;
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
async function enforceIdentity(req, config, deps) {
    if (config.mode === "off")
        return null;
    const user = await (0, auth_1.verifyBearerToken)((0, gate_1.readHeader)(req, "authorization"), deps.verifyIdToken);
    if (config.mode === "paid" && !config.allowlist.has(user.uid)) {
        const paid = await deps.readPaid(user.uid);
        if (!paid)
            throw (0, gate_1.paymentRequiredError)();
    }
    return user;
}
async function guardChat(req, deps) {
    if (req.method && req.method.toUpperCase() !== "POST") {
        throw new gate_1.GateError(405, "method_not_allowed", "POST required.");
    }
    const config = deps.config();
    await enforceAppCheck(req, config, deps);
    const user = await enforceIdentity(req, config, deps);
    const body = asRecord(req.body);
    const feature = (0, gate_1.sanitizeFeature)(body.feature);
    const sessionId = (0, gate_1.sanitizeSessionId)(body.sessionId);
    if (config.interviewsPaused && (0, gate_1.isInterviewFeature)(feature)) {
        throw (0, gate_1.interviewsPausedError)();
    }
    if (!Array.isArray(body.messages)) {
        throw new gate_1.GateError(400, "bad_request", "Bad Request: 'messages' array is required.");
    }
    const requestedModel = (0, modelRouter_1.normalizeModelName)(typeof body.modelName === "string" ? body.modelName : undefined);
    if (!(0, modelRouter_1.isRequestableModel)(requestedModel)) {
        throw new gate_1.GateError(400, "bad_request", `Bad Request: Model '${requestedModel}' is not allowed.`);
    }
    if ((0, gate_1.inputCharCount)(body.messages, body.systemInstruction) > config.maxInputChars) {
        throw (0, gate_1.inputTooLongError)();
    }
    // Allowlist skips entitlements only. The dollar cap applies to every signed-in uid.
    if (user) {
        await deps.assertUnderCostCap(user.uid, (0, gate_1.usEasternDay)(deps.now()), config.dailyUserCostCapUsd);
    }
    if (user && (0, gate_1.isBridgeChatFeature)(feature)) {
        await deps.reserveBridgeChat(user.uid, (0, gate_1.usEasternDay)(deps.now()), config.bridgeDailyCap);
    }
    if (user && (0, gate_1.isInterviewFeature)(feature)) {
        await deps.reserveInterview(user.uid, feature);
    }
    return {
        uid: user?.uid ?? null,
        email: user?.email ?? null,
        email_verified: user?.email_verified ?? false,
        feature,
        sessionId,
    };
}
async function guardJudge(req, deps) {
    if (req.method && req.method.toUpperCase() !== "POST") {
        throw new gate_1.GateError(405, "method_not_allowed", "POST required.");
    }
    const config = deps.config();
    await enforceAppCheck(req, config, deps);
    const user = await enforceIdentity(req, config, deps);
    const body = asRecord(req.body);
    const feature = (0, gate_1.sanitizeFeature)(body.feature);
    if (config.interviewsPaused && (0, gate_1.isInterviewFeature)(feature)) {
        throw (0, gate_1.interviewsPausedError)();
    }
    if (user) {
        await deps.assertUnderCostCap(user.uid, (0, gate_1.usEasternDay)(deps.now()), config.dailyUserCostCapUsd);
    }
    return {
        uid: user?.uid ?? null,
        email: user?.email ?? null,
        email_verified: user?.email_verified ?? false,
        feature,
        sessionId: (0, gate_1.sanitizeSessionId)(body.sessionId),
    };
}
function defaultGuardDeps(overrides = {}) {
    return {
        config: () => (0, gate_1.configFromEnv)(),
        verifyIdToken: async (token) => {
            const { verifyIdTokenWithAdmin } = await Promise.resolve().then(() => __importStar(require("./auth")));
            return verifyIdTokenWithAdmin(token);
        },
        readPaid: async (uid) => {
            const { readEntitlementPaid } = await Promise.resolve().then(() => __importStar(require("./adminStore")));
            return readEntitlementPaid(uid);
        },
        reserveBridgeChat: async (uid, day, cap) => {
            const { reserveBridgeChatSlot } = await Promise.resolve().then(() => __importStar(require("./adminStore")));
            return reserveBridgeChatSlot(uid, day, cap);
        },
        assertUnderCostCap: async (uid, day, capUsd) => {
            const { readDailyCostMicros } = await Promise.resolve().then(() => __importStar(require("./adminStore")));
            const { assertUnderDailyCostCap } = await Promise.resolve().then(() => __importStar(require("./dailyCost")));
            const spentMicros = await readDailyCostMicros(uid, day);
            await assertUnderDailyCostCap({ spentMicros, capUsd });
        },
        reserveInterview: interviewStore_1.reserveInterviewForChat,
        verifyAppCheck: async (token) => {
            const { verifyAppCheckToken } = await Promise.resolve().then(() => __importStar(require("./adminStore")));
            return verifyAppCheckToken(token);
        },
        now: () => new Date(),
        ...overrides,
    };
}
//# sourceMappingURL=guard.js.map