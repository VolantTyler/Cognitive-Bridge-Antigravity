"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.judgeProxy = exports.chatProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const genai_1 = require("@google/genai");
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
exports.chatProxy = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    try {
        const { messages, systemInstruction, modelName, stream } = req.body;
        if (!Array.isArray(messages)) {
            res.status(400).send("Bad Request: 'messages' array is required.");
            return;
        }
        // Clean up the model name. Vertex AI models should be referred by their base names.
        // E.g., if it starts with "models/", strip it.
        let cleanModel = modelName || "gemini-2.5-flash";
        cleanModel = cleanModel.replace(/^models\//, "");
        const ALLOWED_MODELS = [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-pro"
        ];
        if (!ALLOWED_MODELS.includes(cleanModel)) {
            res.status(400).send(`Bad Request: Model '${cleanModel}' is not allowed.`);
            return;
        }
        const contents = messages.map((m) => ({
            role: m.role === "system" ? "user" : m.role,
            parts: [{ text: m.content }]
        }));
        if (stream) {
            // Set headers for Server-Sent Events (SSE) streaming
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            });
            const responseStream = await ai.models.generateContentStream({
                model: cleanModel,
                contents,
                config: {
                    systemInstruction
                }
            });
            for await (const chunk of responseStream) {
                const text = chunk.text || "";
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
            res.write("data: [DONE]\n\n");
            res.end();
        }
        else {
            const response = await ai.models.generateContent({
                model: cleanModel,
                contents,
                config: {
                    systemInstruction
                }
            });
            res.status(200).json({ text: response.text || "" });
        }
    }
    catch (error) {
        console.error("Vertex AI Proxy Error:", error);
        // If headers are already sent, we write the error inside the event stream
        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: error.message || String(error) })}\n\n`);
            res.end();
        }
        else {
            res.status(500).json({ error: error.message || String(error) });
        }
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