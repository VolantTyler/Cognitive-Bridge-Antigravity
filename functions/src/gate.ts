import {
  CHAT_CAP_RESET_TIME_ZONE,
  DEFAULT_BRIDGE_CHAT_DAILY_CAP,
  DEFAULT_DAILY_USER_COST_CAP_USD,
  DEFAULT_MAX_INPUT_CHARS,
  dailyCapMessage,
  AI_ACCESS_MESSAGES,
} from "./accessCopy";

export class GateError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GateError";
    this.status = status;
    this.code = code;
  }
}

export type GateMode = "off" | "auth" | "paid";

export interface VerifiedUser {
  uid: string;
  email: string | null;
  email_verified: boolean;
}

export interface GateConfig {
  mode: GateMode;
  allowlist: ReadonlySet<string>;
  enforceAppCheck: boolean;
  interviewsPaused: boolean;
  bridgeDailyCap: number;
  maxInputChars: number;
  dailyUserCostCapUsd: number;
}

const BRIDGE_CHAT_FEATURES = new Set([
  "bridge",
  "bridge chat",
  "bridge-chat",
  "playground",
  "playground-aligned",
  "playground-unaligned",
]);

const INTERVIEW_FEATURES = new Set(["mirror", "interview"]);

const FEATURE_RE = /^[a-z0-9][a-z0-9 _-]{0,63}$/i;
const SESSION_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function parseGateMode(raw: string | undefined): GateMode {
  const value = (raw ?? "auth").trim().toLowerCase();
  if (value === "off" || value === "auth" || value === "paid") return value;
  return "auth";
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0));
}

function parseFlag(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parsePositiveUsd(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GateConfig {
  return {
    mode: parseGateMode(env.AI_GATE_MODE),
    allowlist: parseAllowlist(env.AI_ALLOWLIST_UIDS),
    enforceAppCheck: parseFlag(env.ENFORCE_APP_CHECK, false),
    interviewsPaused: parseFlag(env.INTERVIEWS_PAUSED, false),
    bridgeDailyCap: parsePositiveInt(env.BRIDGE_CHAT_DAILY_CAP, DEFAULT_BRIDGE_CHAT_DAILY_CAP),
    maxInputChars: parsePositiveInt(env.MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS),
    dailyUserCostCapUsd: parsePositiveUsd(env.DAILY_USER_COST_CAP_USD, DEFAULT_DAILY_USER_COST_CAP_USD),
  };
}

export function usEasternDay(date: Date, timeZone: string = CHAT_CAP_RESET_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function sanitizeFeature(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (!FEATURE_RE.test(trimmed)) return "unknown";
  return trimmed;
}

export function sanitizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SESSION_RE.test(trimmed)) return null;
  return trimmed;
}

export function isBridgeChatFeature(feature: string): boolean {
  return BRIDGE_CHAT_FEATURES.has(feature.trim().toLowerCase());
}

export function isInterviewFeature(feature: string): boolean {
  return INTERVIEW_FEATURES.has(feature.trim().toLowerCase());
}

export function inputCharCount(messages: unknown, systemInstruction: unknown): number {
  let total = typeof systemInstruction === "string" ? systemInstruction.length : 0;
  if (!Array.isArray(messages)) return total;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") total += content.length;
  }
  return total;
}

export interface BridgeUsageBucket {
  day?: unknown;
  count?: unknown;
}

/**
 * Cap unit is one chatProxy request, not one user message.
 *
 * Each Bridge turn makes two requests (playground-aligned and
 * playground-unaligned). BRIDGE_CHAT_DAILY_CAP defaults to 100 requests,
 * about 50 turns. User-facing copy still says "50 messages".
 *
 * A transport failure before the proxy returns fallbacksExhausted can POST
 * again. The server model chain stays inside one request and does not
 * increment again. Mirror (feature "mirror") is not in this counter.
 *
 * A client message id is not used to collapse those calls. Reusing one id
 * would skip the cap and spend Vertex on unlimited requests.
 */
export function nextBridgeUsage(
  existing: BridgeUsageBucket | undefined,
  day: string,
  cap: number
): { day: string; count: number } {
  const sameDay = existing?.day === day && typeof existing.count === "number" && Number.isFinite(existing.count);
  const count = sameDay ? Math.max(0, Math.floor(existing.count as number)) : 0;
  if (count >= cap) {
    throw new GateError(429, "rate_limited", dailyCapMessage());
  }
  return { day, count: count + 1 };
}

export function unauthenticatedError(): GateError {
  return new GateError(401, "unauthenticated", AI_ACCESS_MESSAGES.signed_out);
}

export function sessionExpiredError(): GateError {
  return new GateError(401, "session_expired", AI_ACCESS_MESSAGES.session_ended);
}

export function paymentRequiredError(): GateError {
  return new GateError(402, "payment_required", AI_ACCESS_MESSAGES.payment_required);
}

export function inputTooLongError(): GateError {
  return new GateError(429, "input_too_long", AI_ACCESS_MESSAGES.input_too_long);
}

export function interviewsPausedError(): GateError {
  return new GateError(503, "interviews_paused", AI_ACCESS_MESSAGES.interviews_paused);
}

export function appCheckError(): GateError {
  return new GateError(401, "app_check", AI_ACCESS_MESSAGES.app_check);
}

/**
 * TODO(v2.4.0 FR-16): enforce entitlements/{uid}.interviewsAllowed
 * (2 per purchase: 1 interview + 1 retake). Not implemented in this PR.
 * Stripe, the entitlements writer, and this counter are later PRs.
 * When added, increment usage/{uid}.interviewsUsed in the same transaction
 * style as the bridge daily cap and return 429 when the purchase is used up.
 * Pre-v2.4.0 saved results do not grant a free live-chat or interview exception.
 */
export async function reserveInterviewSlot(_uid: string, _feature: string): Promise<void> {
  return;
}

export interface HeaderSource {
  headers?: Record<string, string | string[] | undefined>;
  header?: (name: string) => string | undefined;
}

export function readHeader(req: HeaderSource, name: string): string | undefined {
  if (typeof req.header === "function") {
    const direct = req.header(name);
    if (typeof direct === "string" && direct.length > 0) return direct;
  }
  const headers = req.headers ?? {};
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}
