"use strict";
/**
 * User-facing lock messages shared by the Cloud Functions responses and the
 * web client (re-exported from src/constants/aiAccess.ts).
 *
 * Plain stand-in copy. Miranda and Charlie replace these after sign-off.
 * Do not put bracketed placeholder tokens in these strings.
 *
 * CHAT_CAP_RESET_LABEL is the single reset phrase. The counter itself uses
 * CHAT_CAP_RESET_TIME_ZONE (US Eastern calendar day, midnight).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_CODE_TO_CLIENT = exports.SERVER_ACCESS_CODES = exports.AI_ACCESS_MESSAGES = exports.AI_ACCESS_CODES = exports.DEFAULT_MAX_INPUT_CHARS = exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP = exports.CHAT_CAP_RESET_LABEL = exports.CHAT_CAP_RESET_TIME_ZONE = void 0;
exports.dailyCapMessage = dailyCapMessage;
exports.CHAT_CAP_RESET_TIME_ZONE = "America/New_York";
exports.CHAT_CAP_RESET_LABEL = "midnight US Eastern";
exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP = 50;
exports.DEFAULT_MAX_INPUT_CHARS = 8000;
exports.AI_ACCESS_CODES = {
    signedOut: "signed_out",
    paymentRequired: "payment_required",
    dailyCap: "daily_cap",
    inputTooLong: "input_too_long",
    interviewsPaused: "interviews_paused",
    appCheck: "app_check",
};
function dailyCapMessage(cap = exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP) {
    return `You've used today's ${cap} chat messages. Chat opens again at ${exports.CHAT_CAP_RESET_LABEL}. Your results are still here.`;
}
exports.AI_ACCESS_MESSAGES = {
    signed_out: "Sign in to continue.",
    payment_required: "This part needs a purchase. If you've paid, try Restore purchase.",
    daily_cap: dailyCapMessage(),
    input_too_long: "That message is too long. Try a shorter one.",
    interviews_paused: "New interviews are paused for now. Your saved results are still available.",
    app_check: "This browser could not be verified. Refresh the page and try again.",
};
/** Server `code` values on /api/chat and /api/judge. */
exports.SERVER_ACCESS_CODES = {
    unauthenticated: "unauthenticated",
    paymentRequired: "payment_required",
    rateLimited: "rate_limited",
    inputTooLong: "input_too_long",
    interviewsPaused: "interviews_paused",
    appCheck: "app_check",
};
exports.SERVER_CODE_TO_CLIENT = {
    unauthenticated: "signed_out",
    payment_required: "payment_required",
    rate_limited: "daily_cap",
    input_too_long: "input_too_long",
    interviews_paused: "interviews_paused",
    app_check: "app_check",
};
//# sourceMappingURL=accessCopy.js.map