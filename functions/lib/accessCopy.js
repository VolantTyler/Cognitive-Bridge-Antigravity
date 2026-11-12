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
exports.SERVER_CODE_TO_CLIENT = exports.SERVER_ACCESS_CODES = exports.AI_ACCESS_MESSAGES = exports.AI_ACCESS_CODES = exports.DEFAULT_DAILY_USER_COST_CAP_USD = exports.DEFAULT_MAX_INPUT_CHARS = exports.DEFAULT_MAX_MESSAGE_CHARS = exports.DEFAULT_BRIDGE_CHAT_DAILY_CAP = exports.BRIDGE_CHAT_DAILY_MESSAGE_COPY = exports.CHAT_CAP_RESET_LABEL = exports.CHAT_CAP_RESET_TIME_ZONE = void 0;
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
/**
 * Latest user message only. Earlier turns are not counted.
 * This is what "That message is too long" means.
 */
exports.DEFAULT_MAX_MESSAGE_CHARS = 4000;
/**
 * Whole chat request: system instruction plus every message.
 * Separate from DEFAULT_MAX_MESSAGE_CHARS. Over the cap, the
 * server returns conversation_too_long, not input_too_long.
 *
 * Measured 2026-11-12. Mirror 5th-answer request:
 *   MIRROR_SYSTEM_PROMPT 2,762 + INITIAL_MIRROR_MESSAGE 410
 *   + four question replies at 2,500 (replies in agent_test_report.md
 *     run about 1,800–2,800) + five answers at the per-message cap
 *   = 33,172
 * Bridge turn 50 is the existing daily cap. Same per-message cap,
 * 2,500-character replies, and the longest alignment prompt (~2,200):
 *   = about 325,000
 * 400,000 covers that full day with headroom. It is not the
 * per-message limit.
 */
exports.DEFAULT_MAX_INPUT_CHARS = 400000;
/** Placeholder launch cap. Retune after the 10–20 test interviews. Not shown to users. */
exports.DEFAULT_DAILY_USER_COST_CAP_USD = 1;
exports.AI_ACCESS_CODES = {
    signedOut: "signed_out",
    sessionEnded: "session_ended",
    paymentRequired: "payment_required",
    dailyCap: "daily_cap",
    costCap: "cost_cap",
    inputTooLong: "input_too_long",
    conversationTooLong: "conversation_too_long",
    interviewsPaused: "interviews_paused",
    interviewsExhausted: "interviews_exhausted",
    appCheck: "app_check",
};
/** Request-count cap. Does not print the 100-request ceiling. */
function dailyCapMessage() {
    return `You've reached today's chat limit (up to ${exports.BRIDGE_CHAT_DAILY_MESSAGE_COPY} messages a day). Chat opens again at ${exports.CHAT_CAP_RESET_LABEL}. Your results are still here.`;
}
/**
 * Dollar cap. Checked on every guarded chatProxy and judgeProxy call, including
 * Mirror and scoring, so the wording is a usage limit. The 50-message line
 * stays on the bridge request cap only.
 */
function costCapMessage() {
    return `You've reached today's usage limit. It resets at ${exports.CHAT_CAP_RESET_LABEL}. Your results are still here.`;
}
exports.AI_ACCESS_MESSAGES = {
    signed_out: "Sign in to save your progress.",
    session_ended: "Your session ended. Sign in to save your progress.",
    payment_required: "This part needs a purchase. If you've paid, try Restore purchase.",
    daily_cap: dailyCapMessage(),
    cost_cap: costCapMessage(),
    input_too_long: "That message is too long. Try a shorter one.",
    conversation_too_long: "This conversation is too long to continue. Start a new chat to keep going. Your results are still here.",
    interviews_paused: "New interviews are paused for now. Your results are still available if you're signed in.",
    interviews_exhausted: "You've used both interviews included with your purchase. Your results stay available. Each account can buy once.",
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
    conversationTooLong: "conversation_too_long",
    interviewsPaused: "interviews_paused",
    interviewsExhausted: "interviews_exhausted",
    appCheck: "app_check",
};
exports.SERVER_CODE_TO_CLIENT = {
    unauthenticated: "signed_out",
    session_expired: "session_ended",
    payment_required: "payment_required",
    rate_limited: "daily_cap",
    cost_cap_reached: "cost_cap",
    input_too_long: "input_too_long",
    conversation_too_long: "conversation_too_long",
    interviews_paused: "interviews_paused",
    interviews_exhausted: "interviews_exhausted",
    app_check: "app_check",
};
//# sourceMappingURL=accessCopy.js.map