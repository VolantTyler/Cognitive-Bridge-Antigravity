"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const genai_1 = require("@google/genai");
const modelRouter_1 = require("./modelRouter");
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
//# sourceMappingURL=index.js.map