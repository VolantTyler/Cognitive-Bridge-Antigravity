"use strict";
/**
 * PLACEHOLDER prices in USD per 1,000,000 tokens.
 * Verify against the current Vertex AI / Gemini price card before any
 * go/no-go. Retune this one module; the cost cap and scripts/cost-report.ts
 * both read it. These numbers are not authoritative.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.USD_MICROS = exports.PRICING = void 0;
exports.highestPrice = highestPrice;
exports.priceForModel = priceForModel;
exports.costUsdForUsage = costUsdForUsage;
exports.costMicrosForUsage = costMicrosForUsage;
exports.usdToMicros = usdToMicros;
exports.PRICING = {
    placeholder: true,
    comment: "PLACEHOLDER prices in USD per 1,000,000 tokens. Verify against the current Vertex AI / Gemini price card before any cost go/no-go. These numbers are not authoritative.",
    models: {
        "gemini-2.5-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
        "gemini-2.5-flash-lite": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
        "gemini-3.5-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
        "gemini-3.1-pro-preview": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
        "gemini-3.8-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
        "jev-latest": { inputPerMillionUsd: 0, outputPerMillionUsd: 0, perCallUsd: 0 },
    },
    default: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
};
exports.USD_MICROS = 1_000_000;
function highestPrice(table = exports.PRICING) {
    let best = table.default;
    let bestScore = -1;
    for (const row of Object.values(table.models)) {
        const score = row.inputPerMillionUsd + row.outputPerMillionUsd + (row.perCallUsd ?? 0);
        if (score > bestScore) {
            best = row;
            bestScore = score;
        }
    }
    return best;
}
/** Unknown models use the most expensive known card so the cap does not under-count. */
function priceForModel(model, table = exports.PRICING) {
    if (model && table.models[model])
        return table.models[model];
    return highestPrice(table);
}
function costUsdForUsage(input, table = exports.PRICING) {
    const price = priceForModel(input.model, table);
    const prompt = finiteTokens(input.promptTokens);
    const completion = finiteTokens(input.completionTokens);
    return (prompt / 1_000_000) * price.inputPerMillionUsd
        + (completion / 1_000_000) * price.outputPerMillionUsd
        + (price.perCallUsd ?? 0);
}
function costMicrosForUsage(input, table = exports.PRICING) {
    const usd = costUsdForUsage(input, table);
    if (!Number.isFinite(usd) || usd <= 0)
        return 0;
    return Math.round(usd * exports.USD_MICROS);
}
function usdToMicros(usd) {
    if (!Number.isFinite(usd) || usd <= 0)
        return 0;
    return Math.round(usd * exports.USD_MICROS);
}
function finiteTokens(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
//# sourceMappingURL=pricing.js.map