/**
 * App import path for AI lock messages and the daily-cap reset.
 * The strings are defined once in functions/src/accessCopy.ts so the
 * Cloud Functions responses and this client stay the same text.
 * Plain stand-in copy until Miranda and Charlie sign off.
 */

export {
  AI_ACCESS_CODES,
  AI_ACCESS_MESSAGES,
  CHAT_CAP_RESET_LABEL,
  CHAT_CAP_RESET_TIME_ZONE,
  DEFAULT_BRIDGE_CHAT_DAILY_CAP,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_MAX_MESSAGE_CHARS,
  SERVER_ACCESS_CODES,
  SERVER_CODE_TO_CLIENT,
  dailyCapMessage,
} from "../../functions/src/accessCopy";

export type { AiAccessCode, ServerAccessCode } from "../../functions/src/accessCopy";
