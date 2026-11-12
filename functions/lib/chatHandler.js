"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChat = handleChat;
const modelRouter_1 = require("./modelRouter");
const guard_1 = require("./guard");
const gate_1 = require("./gate");
const usageLog_1 = require("./usageLog");
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
function sendGate(res, error) {
    if (res.headersSent)
        return;
    console.warn(`chatProxy denied code=${error.code}`);
    res.status(error.status).json({ error: error.message, code: error.code });
}
async function noteInterviewStarted(deps, ctx) {
    if (!deps.markInterviewStarted || !ctx.uid)
        return;
    try {
        await deps.markInterviewStarted(ctx);
    }
    catch {
        console.error("interview start mark failed");
    }
}
async function safeLog(deps, ctx, model, promptTokens, completionTokens) {
    if (!ctx.uid)
        return;
    try {
        await deps.logUsage((0, usageLog_1.buildUsageRecord)({
            uid: ctx.uid,
            sessionId: ctx.sessionId,
            reservationId: (0, guard_1.sanitizeReservationId)(ctx.reservationId),
            feature: ctx.feature,
            model,
            promptTokens,
            completionTokens,
        }));
    }
    catch {
        console.error("usage_server write failed");
    }
}
async function handleChat(req, res, deps) {
    const failures = [];
    try {
        const ctx = await deps.guard(req);
        const body = (req.body ?? {});
        const messages = body.messages ?? [];
        const requestedModel = (0, modelRouter_1.normalizeModelName)(body.modelName);
        if (!(0, modelRouter_1.isRequestableModel)(requestedModel)) {
            res.status(400).send(`Bad Request: Model '${requestedModel}' is not allowed.`);
            return;
        }
        const contents = messages.map((message) => ({
            role: message.role === "system" ? "user" : message.role,
            parts: [{ text: message.content }],
        }));
        const chain = (0, modelRouter_1.buildModelChain)(requestedModel);
        const requestConfig = { systemInstruction: body.systemInstruction };
        if (body.stream) {
            let opened = null;
            for (const model of chain) {
                try {
                    const responseStream = await deps.ai.models.generateContentStream({
                        model,
                        contents,
                        config: requestConfig,
                    });
                    const iterator = responseStream[Symbol.asyncIterator]();
                    const first = await iterator.next();
                    opened = { model, iterator, first };
                    break;
                }
                catch (error) {
                    const kind = (0, modelRouter_1.classifyModelError)(error);
                    failures.push({ model, kind });
                    console.warn(`chatProxy stream open failed for ${model} (${kind})`);
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
            await noteInterviewStarted(deps, ctx);
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            if (opened.model !== requestedModel) {
                res.write(`data: ${JSON.stringify({
                    fallback: { from: requestedModel, to: opened.model },
                })}\n\n`);
            }
            const seen = [];
            const writeChunk = (chunk) => {
                if (chunk)
                    seen.push(chunk);
                const text = chunk?.text || "";
                if (text) {
                    res.write(`data: ${JSON.stringify({ text, model: opened?.model })}\n\n`);
                }
            };
            try {
                if (!opened.first.done)
                    writeChunk(opened.first.value);
                while (true) {
                    const next = await opened.iterator.next();
                    if (next.done)
                        break;
                    writeChunk(next.value);
                }
                const usage = (0, usageLog_1.usageFromChunks)(seen);
                await safeLog(deps, ctx, opened.model, usage.promptTokens, usage.completionTokens);
                res.write("data: [DONE]\n\n");
                res.end();
            }
            catch (error) {
                const kind = (0, modelRouter_1.classifyModelError)(error);
                failures.push({ model: opened.model, kind });
                console.warn(`chatProxy stream failed mid-response for ${opened.model} (${kind})`);
                sendTerminalError(res, failures, error);
            }
            return;
        }
        let responseText = "";
        let activeModel = requestedModel;
        let succeeded = false;
        let promptTokens = 0;
        let completionTokens = 0;
        for (const model of chain) {
            try {
                const response = await deps.ai.models.generateContent({
                    model,
                    contents,
                    config: requestConfig,
                });
                responseText = response.text || "";
                activeModel = model;
                const usage = (0, usageLog_1.usageFromChunks)([response]);
                promptTokens = usage.promptTokens;
                completionTokens = usage.completionTokens;
                succeeded = true;
                break;
            }
            catch (error) {
                const kind = (0, modelRouter_1.classifyModelError)(error);
                failures.push({ model, kind });
                console.warn(`chatProxy generate failed for ${model} (${kind})`);
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
        await noteInterviewStarted(deps, ctx);
        await safeLog(deps, ctx, activeModel, promptTokens, completionTokens);
        res.status(200).json({
            text: responseText,
            model: activeModel,
            fallback: activeModel === requestedModel ? undefined : { from: requestedModel, to: activeModel },
        });
    }
    catch (error) {
        if (error instanceof gate_1.GateError) {
            sendGate(res, error);
            return;
        }
        console.error("Vertex AI Proxy Error");
        sendTerminalError(res, failures, error);
    }
}
//# sourceMappingURL=chatHandler.js.map