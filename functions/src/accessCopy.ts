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

export const CHAT_CAP_RESET_TIME_ZONE = "America/New_York";
export const CHAT_CAP_RESET_LABEL = "midnight US Eastern";

/**
 * User-facing line is "up to 50 messages a day, resets at midnight US Eastern".
 * "up to" stays because a retry can use an extra request. The server counts
 * requests. Default is 100 requests, about 50 turns, because each Bridge
 * turn makes two chatProxy calls (aligned and unaligned).
 */
export const BRIDGE_CHAT_DAILY_MESSAGE_COPY = 50;
export const DEFAULT_BRIDGE_CHAT_DAILY_CAP = 100;
export const DEFAULT_MAX_INPUT_CHARS = 8000;

export const AI_ACCESS_CODES = {
  signedOut: "signed_out",
  sessionEnded: "session_ended",
  paymentRequired: "payment_required",
  dailyCap: "daily_cap",
  inputTooLong: "input_too_long",
  interviewsPaused: "interviews_paused",
  appCheck: "app_check",
} as const;

export type AiAccessCode = (typeof AI_ACCESS_CODES)[keyof typeof AI_ACCESS_CODES];

/** Fixed copy. Does not print the request cap (default 100). "up to" stays because a retry can use an extra request. */
export function dailyCapMessage(): string {
  return `up to ${BRIDGE_CHAT_DAILY_MESSAGE_COPY} messages a day, resets at ${CHAT_CAP_RESET_LABEL}`;
}

export const AI_ACCESS_MESSAGES: Record<AiAccessCode, string> = {
  signed_out: "Sign in to save your progress.",
  session_ended: "Your session ended. Sign in to save your progress.",
  payment_required: "This is part of Cognitive Bridge: Personal Interview and Results ($6, one-time). Already bought it? Try Restore purchase.",
  daily_cap: dailyCapMessage(),
  input_too_long: "That message is too long. Try a shorter one.",
  interviews_paused: "New interviews are paused for now. Your results are still available.",
  app_check: "We couldn't connect just now. Refresh the page and try again.",
};

/** Server `code` values on /api/chat and /api/judge. */
export const SERVER_ACCESS_CODES = {
  unauthenticated: "unauthenticated",
  sessionExpired: "session_expired",
  paymentRequired: "payment_required",
  rateLimited: "rate_limited",
  inputTooLong: "input_too_long",
  interviewsPaused: "interviews_paused",
  appCheck: "app_check",
} as const;

export type ServerAccessCode = (typeof SERVER_ACCESS_CODES)[keyof typeof SERVER_ACCESS_CODES];

export const SERVER_CODE_TO_CLIENT: Record<ServerAccessCode, AiAccessCode> = {
  unauthenticated: "signed_out",
  session_expired: "session_ended",
  payment_required: "payment_required",
  rate_limited: "daily_cap",
  input_too_long: "input_too_long",
  interviews_paused: "interviews_paused",
  app_check: "app_check",
};
