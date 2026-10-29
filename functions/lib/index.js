"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.judgeProxy = exports.chatProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const genai_1 = require("@google/genai");
const modelRouter_1 = require("./modelRouter");
const TYPESAFE_DECIDE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const MAX_STATE_CHARS = 20000;
const MAX_QUESTIONS = 12;
const MAX_INSTRUCTION_CHARS = 800;
const MAX_CRITERIA = 8;
const MAX_CRITERION_CHARS = 400;
// Initialize GoogleGenAI in vertexai mode.
// It will automatically read GCP project and location configuration from environment or ADC.
const ai = new genai_1.GoogleGenAI({
    vertexai: true,
    project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID,
    location: "us-central1"
});
function sendTerminalError(res, failures, error) {
    const kind = (0, modelRouter_1.dominantFailureKind)(failures);
    const message = failures.length > 0
        ? (0, modelRouter_1.chainExhaustedMessage)(failures)
        : error?.message || String(error);
    const status = failures.length > 0 ? (0, modelRouter_1.httpStatusForKind)(kind) : 500;
    const body = {
        error: message,
        fallbacksExhausted: true,
        code: status,
        failures,
    };
    if (res.headersSent) {
        res.write(`data: ${JSON.stringify(body)}\n\n`);
        res.end();
        return;
    }
    res.status(status).json(body);
}
exports.chatProxy = (0, https_1.onRequest)({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
    const failures = [];
    try {
        const { messages, systemInstruction, modelName, stream } = req.body;
        if (!Array.isArray(messages)) {
            res.status(400).send("Bad Request: 'messages' array is required.");
            return;
        }
        // Vertex model ids are bare names. Strip a client "models/" prefix.
        const requestedModel = (0, modelRouter_1.normalizeModelName)(modelName);
        if (!(0, modelRouter_1.isRequestableModel)(requestedModel)) {
            res.status(400).send(`Bad Request: Model '${requestedModel}' is not allowed.`);
            return;
        }
        const contents = messages.map((m) => ({
            role: m.role === "system" ? "user" : m.role,
            parts: [{ text: m.content }]
        }));
        const chain = (0, modelRouter_1.buildModelChain)(requestedModel);
        if (stream) {
            // 503/404 usually surface when the first chunk is pulled, not when the
            // stream object is created. Peek that chunk before writing headers so a
            // dead or overloaded model can still fall through to the next id.
            let opened = null;
            for (const model of chain) {
                try {
                    const responseStream = await ai.models.generateContentStream({
                        model,
                        contents,
                        config: {
                            systemInstruction
                        }
                    });
                    const iterator = responseStream[Symbol.asyncIterator]();
                    const first = await iterator.next();
                    opened = { model, iterator, first };
                    break;
                }
                catch (error) {
                    const kind = (0, modelRouter_1.classifyModelError)(error);
                    failures.push({ model, kind });
                    console.warn(`chatProxy stream open failed for ${model} (${kind}):`, error);
                    if (kind === "quota" || kind === "auth" || kind === "other") {
                        sendTerminalError(res, failures, error);
                        return;
                    }
                }
            }
            if (!opened) {
                sendTerminalError(res, failures, new Error("No Gemini model accepted the stream."));
                return;
            }
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });
            if (opened.model !== requestedModel) {
                res.write(`data: ${JSON.stringify({
                    fallback: { from: requestedModel, to: opened.model }
                })}\n\n`);
            }
            const writeChunk = (chunk) => {
                const text = chunk?.text || "";
                if (text) {
                    res.write(`data: ${JSON.stringify({ text, model: opened?.model })}\n\n`);
                }
            };
            try {
                if (!opened.first.done) {
                    writeChunk(opened.first.value);
                }
                while (true) {
                    const next = await opened.iterator.next();
                    if (next.done)
                        break;
                    writeChunk(next.value);
                }
                res.write("data: [DONE]\n\n");
                res.end();
            }
            catch (error) {
                const kind = (0, modelRouter_1.classifyModelError)(error);
                failures.push({ model: opened.model, kind });
                console.warn(`chatProxy stream failed mid-response for ${opened.model} (${kind}):`, error);
                sendTerminalError(res, failures, error);
            }
            return;
        }
        let responseText = "";
        let activeModel = requestedModel;
        let succeeded = false;
        for (const model of chain) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents,
                    config: {
                        systemInstruction
                    }
                });
                responseText = response.text || "";
                activeModel = model;
                succeeded = true;
                break;
            }
            catch (error) {
                const kind = (0, modelRouter_1.classifyModelError)(error);
                failures.push({ model, kind });
                console.warn(`chatProxy generate failed for ${model} (${kind}):`, error);
                if (kind === "quota" || kind === "auth" || kind === "other") {
                    sendTerminalError(res, failures, error);
                    return;
                }
            }
        }
        if (!succeeded) {
            sendTerminalError(res, failures, new Error("No Gemini model accepted the request."));
            return;
        }
        res.status(200).json({
            text: responseText,
            model: activeModel,
            fallback: activeModel === requestedModel ? undefined : { from: requestedModel, to: activeModel },
        });
    }
    catch (error) {
        console.error("Vertex AI Proxy Error:", error);
        sendTerminalError(res, failures, error);
    }
});
function isJudgeQuestion(value) {
    if (typeof value.instructions !== "string" || value.instructions.length === 0 || value.instructions.length > MAX_INSTRUCTION_CHARS) {
        return false;
    }
    if (value.type === "noul") {
        return value.criteria === undefined;
    }
    if (value.type === "choice") {
        if (!value.criteria || typeof value.criteria !== "object" || Array.isArray(value.criteria)) {
            return false;
        }
        const entries = Object.entries(value.criteria);
        if (entries.length < 2 || entries.length > MAX_CRITERIA)
            return false;
        return entries.every(([key, text]) => key.length > 0 && key.length <= 64 && typeof text === "string" && text.length > 0 && text.length <= MAX_CRITERION_CHARS);
    }
    if (value.type === "score") {
        if (!Array.isArray(value.criteria))
            return false;
        if (value.criteria.length < 2 || value.criteria.length > 10)
            return false;
        return value.criteria.every((text) => typeof text === "string" && text.length > 0 && text.length <= MAX_CRITERION_CHARS);
    }
    return false;
}
exports.judgeProxy = (0, https_1.onRequest)({ cors: true, timeoutSeconds: 30 }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({ unavailable: true, reason: "method_not_allowed" });
        return;
    }
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
        res.status(503).json({ unavailable: true, reason: "missing_key" });
        return;
    }
    const state = req.body?.state;
    const questions = req.body?.questions;
    if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_CHARS) {
        res.status(400).json({ unavailable: true, reason: "bad_state" });
        return;
    }
    if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
        res.status(400).json({ unavailable: true, reason: "bad_questions" });
        return;
    }
    const entries = Object.entries(questions);
    if (entries.length === 0 || entries.length > MAX_QUESTIONS) {
        res.status(400).json({ unavailable: true, reason: "bad_questions" });
        return;
    }
    if (!entries.every(([key, question]) => key.length > 0 && key.length <= 64 && isJudgeQuestion(question))) {
        res.status(400).json({ unavailable: true, reason: "bad_questions" });
        return;
    }
    try {
        const response = await fetch(TYPESAFE_DECIDE_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: JEV_MODEL,
                state,
                questions,
            }),
        });
        if (response.status === 402) {
            res.status(402).json({ unavailable: true, reason: "payment_required" });
            return;
        }
        if (!response.ok) {
            console.error("Jev judge HTTP error:", response.status);
            res.status(502).json({ unavailable: true, reason: "upstream_error" });
            return;
        }
        const payload = await response.json();
        if (!payload.answers || typeof payload.answers !== "object") {
            res.status(502).json({ unavailable: true, reason: "bad_upstream" });
            return;
        }
        res.status(200).json({
            answers: payload.answers,
            model: typeof payload.model === "string" ? payload.model : JEV_MODEL,
        });
    }
    catch (error) {
        console.error("Jev judge proxy error:", error instanceof Error ? error.message : String(error));
        res.status(502).json({ unavailable: true, reason: "upstream_error" });
    }
});
//# sourceMappingURL=index.js.map