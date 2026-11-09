"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenCount = tokenCount;
exports.usageFromChunks = usageFromChunks;
exports.buildUsageRecord = buildUsageRecord;
exports.usageRecordKeys = usageRecordKeys;
exports.judgeUsageRecord = judgeUsageRecord;
const USAGE_FIELDS = [
    "uid",
    "sessionId",
    "feature",
    "model",
    "promptTokens",
    "completionTokens",
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
    const record = {
        uid: input.uid,
        sessionId: input.sessionId,
        feature: input.feature,
        model: input.model,
        promptTokens: tokenCount(input.promptTokens),
        completionTokens: tokenCount(input.completionTokens),
    };
    if (input.ts !== undefined)
        record.ts = input.ts;
    return record;
}
function usageRecordKeys(record) {
    return Object.keys(record).filter((key) => USAGE_FIELDS.includes(key));
}
function judgeUsageRecord(input) {
    return buildUsageRecord({
        uid: input.uid,
        sessionId: input.sessionId,
        feature: "judge",
        model: input.model,
        promptTokens: 0,
        completionTokens: 0,
        ts: input.ts,
    });
}
//# sourceMappingURL=usageLog.js.map