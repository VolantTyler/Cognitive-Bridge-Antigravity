"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyCostDocPath = dailyCostDocPath;
exports.microsOnDay = microsOnDay;
exports.isDailyCostCapped = isDailyCostCapped;
exports.costCapReachedError = costCapReachedError;
exports.assertUnderDailyCostCap = assertUnderDailyCostCap;
const accessCopy_1 = require("./accessCopy");
const gate_1 = require("./gate");
const pricing_1 = require("./pricing");
/**
 * One document per uid per US Eastern day:
 * daily_cost/{uid}/days/{yyyy-mm-dd} { usdMicros }.
 *
 * The check is one read. The increment happens later, after the model call,
 * with FieldValue.increment. Two requests that both read under the cap can
 * both run, so the day's total can overshoot the cap by about one in-flight
 * call. That race is accepted so the pre-check stays a single document read.
 *
 * AI_ALLOWLIST_UIDS does not skip this cap. The allowlist only skips the
 * paid-entitlement check.
 */
function dailyCostDocPath(uid, day) {
    return `daily_cost/${uid}/days/${day}`;
}
function microsOnDay(storedDay, storedMicros, day) {
    if (storedDay !== day || typeof storedMicros !== "number" || !Number.isFinite(storedMicros))
        return 0;
    return Math.max(0, Math.floor(storedMicros));
}
function isDailyCostCapped(spentMicros, capUsd) {
    return spentMicros >= (0, pricing_1.usdToMicros)(capUsd);
}
function costCapReachedError() {
    return new gate_1.GateError(429, "cost_cap_reached", (0, accessCopy_1.costCapMessage)());
}
async function assertUnderDailyCostCap(input) {
    if (isDailyCostCapped(input.spentMicros, input.capUsd)) {
        throw costCapReachedError();
    }
}
//# sourceMappingURL=dailyCost.js.map