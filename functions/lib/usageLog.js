"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenCount = tokenCount;
exports.usageFromChunks = usageFromChunks;
exports.buildUsageRecord = buildUsageRecord;
exports.usageLogLine = usageLogLine;
exports.usageRecordKeys = usageRecordKeys;
exports.judgeUsageRecord = judgeUsageRecord;
const pricing_1 = require("./pricing");
const USAGE_FIELDS = [
    "uid",
    "sessionId",
    "reservationId",
    "feature",
    "model",
    "promptTokens",
    "completionTokens",
    "costMicros",
    "ts",
];
function tokenCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        return 0;
    return Math.floor(value);
}
function usageFromChunks(chunks) {
    let promptTokens = 0;
    let completionTokens = 0;
    for (const chunk of chunks) {
        const meta = chunk?.usageMetadata;
        if (!meta)
            continue;
        promptTokens = tokenCount(meta.promptTokenCount);
        completionTokens = tokenCount(meta.candidatesTokenCount);
    }
    return { promptTokens, completionTokens };
}
function buildUsageRecord(input) {
    const promptTokens = tokenCount(input.promptTokens);
    const completionTokens = tokenCount(input.completionTokens);
    const record = {
        uid: input.uid,
        sessionId: input.sessionId,
        reservationId: input.reservationId ?? null,
        feature: input.feature,
        model: input.model,
        promptTokens,
        completionTokens,
        costMicros: (0, pricing_1.costMicrosForUsage)({
            model: input.model,
            promptTokens,
            completionTokens,
        }),
    };
    if (input.ts !== undefined)
        record.ts = input.ts;
    return record;
}
/** One secret-free line. Message text, prompts, and keys are not fields on this object. */
function usageLogLine(record) {
    const costMicros = typeof record.costMicros === "number" && Number.isFinite(record.costMicros) && record.costMicros >= 0
        ? Math.round(record.costMicros)
        : (0, pricing_1.costMicrosForUsage)(record);
    return {
        reservationId: typeof record.reservationId === "string" && record.reservationId.length > 0
            ? record.reservationId
            : null,
        uid: record.uid,
        feature: record.feature,
        model: record.model,
        promptTokens: tokenCount(record.promptTokens),
        completionTokens: tokenCount(record.completionTokens),
        costMicros,
    };
}
function usageRecordKeys(record) {
    return Object.keys(record).filter((key) => USAGE_FIELDS.includes(key));
}
function judgeUsageRecord(input) {
    return buildUsageRecord({
        uid: input.uid,
        sessionId: input.sessionId,
        reservationId: input.reservationId ?? null,
        feature: "judge",
        model: input.model,
        promptTokens: 0,
        completionTokens: 0,
        ts: input.ts,
    });
}
//# sourceMappingURL=usageLog.js.map