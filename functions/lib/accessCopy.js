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
exports.SERVER_CODE_TO_CLIENT = exports.SERVER_ACCESS_CODES = exports.AI_ACCESS_MESSAGES = exports.AI_ACCESS_CODES = exports.DEFAULT_DAILY_USER_COST_CAP_USD = exports.DEFAULT_MAX_INPUT_CHARS = exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP = exports.BRIDGE_CHAT_DAILY_MESSAGE_COPY = exports.CHAT_CAP_RESET_LABEL = exports.CHAT_CAP_RESET_TIME_ZONE = void 0;
exports.dailyCapMessage = dailyCapMessage;
exports.costCapMessage = costCapMessage;
exports.CHAT_CAP_RESET_TIME_ZONE = "America/New_York";
exports.CHAT_CAP_RESET_LABEL = "midnight US Eastern";
/**
 * User-facing line for the request cap. "up to" stays because a retry can
 * use an extra request. The server counts requests. Default is 100 requests,
 * about 50 turns, because each Bridge turn makes two chatProxy calls
 * (aligned and unaligned).
 */
exports.BRIDGE_CHAT_DAILY_MESSAGE_COPY = 50;
exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP = 100;
exports.DEFAULT_MAX_INPUT_CHARS = 8000;
/** Placeholder launch cap. Retune after the 10–20 test interviews. Not shown to users. */
exports.DEFAULT_DAILY_USER_COST_CAP_USD = 1;
exports.AI_ACCESS_CODES = {
    signedOut: "signed_out",
    sessionEnded: "session_ended",
    paymentRequired: "payment_required",
    dailyCap: "daily_cap",
    costCap: "cost_cap",
    inputTooLong: "input_too_long",
    interviewsPaused: "interviews_paused",
    appCheck: "app_check",
};
/** Request-count cap. Does not print the 100-request ceiling. */
function dailyCapMessage() {
    return `You've reached today's chat limit (up to ${exports.BRIDGE_CHAT_DAILY_MESSAGE_COPY} messages a day). Chat opens again at ${exports.CHAT_CAP_RESET_LABEL}. Your results are still here.`;
}
/** Dollar cap. No amounts, and no talk of cost. Same Eastern-day reset as the message cap. */
function costCapMessage() {
    return `You've reached today's chat limit. It resets at ${exports.CHAT_CAP_RESET_LABEL}.`;
}
exports.AI_ACCESS_MESSAGES = {
    signed_out: "Sign in to save your progress.",
    session_ended: "Your session ended. Sign in to save your progress.",
    payment_required: "This is part of Cognitive Bridge: Personal Interview and Results ($6, one-time). Already bought it? Try Restore purchase.",
    daily_cap: dailyCapMessage(),
    cost_cap: costCapMessage(),
    input_too_long: "That message is too long. Try a shorter one.",
    interviews_paused: "New interviews are paused for now. Your results are still available.",
    app_check: "We couldn't connect just now. Refresh the page and try again.",
};
/** Server `code` values on /api/chat and /api/judge. */
exports.SERVER_ACCESS_CODES = {
    unauthenticated: "unauthenticated",
    sessionExpired: "session_expired",
    paymentRequired: "payment_required",
    rateLimited: "rate_limited",
    costCapReached: "cost_cap_reached",
    inputTooLong: "input_too_long",
    interviewsPaused: "interviews_paused",
    appCheck: "app_check",
};
exports.SERVER_CODE_TO_CLIENT = {
    unauthenticated: "signed_out",
    session_expired: "session_ended",
    payment_required: "payment_required",
    rate_limited: "daily_cap",
    cost_cap_reached: "cost_cap",
    input_too_long: "input_too_long",
    interviews_paused: "interviews_paused",
    app_check: "app_check",
};
//# sourceMappingURL=accessCopy.js.map