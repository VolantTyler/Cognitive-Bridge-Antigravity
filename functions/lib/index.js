"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.judgeProxy = exports.chatProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const genai_1 = require("@google/genai");
const cors_1 = require("./cors");
const chatHandler_1 = require("./chatHandler");
const judgeHandler_1 = require("./judgeHandler");
const guard_1 = require("./guard");
const params_1 = require("./params");
const adminStore_1 = require("./adminStore");
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
}
function guardDeps() {
    return (0, guard_1.defaultGuardDeps)({ config: () => (0, params_1.loadGateConfig)() });
}
exports.chatProxy = (0, https_1.onRequest)({ cors, timeoutSeconds: 120 }, async (req, res) => {
    const deps = guardDeps();
    await (0, chatHandler_1.handleChat)(req, res, {
        guard: (incoming) => (0, guard_1.guardChat)(incoming, deps),
        ai: ai,
        logUsage,
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
//# sourceMappingURL=index.js.map