"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GateError = void 0;
exports.parseGateMode = parseGateMode;
exports.parseAllowlist = parseAllowlist;
exports.configFromEnv = configFromEnv;
exports.usEasternDay = usEasternDay;
exports.sanitizeFeature = sanitizeFeature;
exports.sanitizeSessionId = sanitizeSessionId;
exports.isBridgeChatFeature = isBridgeChatFeature;
exports.isInterviewFeature = isInterviewFeature;
exports.inputCharCount = inputCharCount;
exports.nextBridgeUsage = nextBridgeUsage;
exports.unauthenticatedError = unauthenticatedError;
exports.sessionExpiredError = sessionExpiredError;
exports.paymentRequiredError = paymentRequiredError;
exports.inputTooLongError = inputTooLongError;
exports.interviewsPausedError = interviewsPausedError;
exports.appCheckError = appCheckError;
exports.reserveInterviewSlot = reserveInterviewSlot;
exports.readHeader = readHeader;
exports.bearerToken = bearerToken;
const accessCopy_1 = require("./accessCopy");
class GateError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.name = "GateError";
        this.status = status;
        this.code = code;
    }
}
exports.GateError = GateError;
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
function parseGateMode(raw) {
    const value = (raw ?? "auth").trim().toLowerCase();
    if (value === "off" || value === "auth" || value === "paid")
        return value;
    return "auth";
}
function parseAllowlist(raw) {
    if (!raw)
        return new Set();
    return new Set(raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0));
}
function parseFlag(raw, fallback = false) {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const value = raw.trim().toLowerCase();
    if (value === "true" || value === "1" || value === "yes")
        return true;
    if (value === "false" || value === "0" || value === "no")
        return false;
    return fallback;
}
function parsePositiveInt(raw, fallback) {
    if (raw === undefined || raw.trim() === "")
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.floor(parsed);
}
function configFromEnv(env = process.env) {
    return {
        mode: parseGateMode(env.AI_GATE_MODE),
        allowlist: parseAllowlist(env.AI_ALLOWLIST_UIDS),
        enforceAppCheck: parseFlag(env.ENFORCE_APP_CHECK, false),
        interviewsPaused: parseFlag(env.INTERVIEWS_PAUSED, false),
        bridgeDailyCap: parsePositiveInt(env.BRIDGE_CHAT_DAILY_CAP, accessCopy_1.DEFAULT_BRIDGE_CHAT_DAILY_CAP),
        maxInputChars: parsePositiveInt(env.MAX_INPUT_CHARS, accessCopy_1.DEFAULT_MAX_INPUT_CHARS),
    };
}
function usEasternDay(date, timeZone = accessCopy_1.CHAT_CAP_RESET_TIME_ZONE) {
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
function sanitizeFeature(value) {
    if (typeof value !== "string")
        return "unknown";
    const trimmed = value.trim();
    if (!FEATURE_RE.test(trimmed))
        return "unknown";
    return trimmed;
}
function sanitizeSessionId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!SESSION_RE.test(trimmed))
        return null;
    return trimmed;
}
function isBridgeChatFeature(feature) {
    return BRIDGE_CHAT_FEATURES.has(feature.trim().toLowerCase());
}
function isInterviewFeature(feature) {
    return INTERVIEW_FEATURES.has(feature.trim().toLowerCase());
}
function inputCharCount(messages, systemInstruction) {
    let total = typeof systemInstruction === "string" ? systemInstruction.length : 0;
    if (!Array.isArray(messages))
        return total;
    for (const message of messages) {
        if (!message || typeof message !== "object")
            continue;
        const content = message.content;
        if (typeof content === "string")
            total += content.length;
    }
    return total;
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
function nextBridgeUsage(existing, day, cap) {
    const sameDay = existing?.day === day && typeof existing.count === "number" && Number.isFinite(existing.count);
    const count = sameDay ? Math.max(0, Math.floor(existing.count)) : 0;
    if (count >= cap) {
        throw new GateError(429, "rate_limited", (0, accessCopy_1.dailyCapMessage)());
    }
    return { day, count: count + 1 };
}
function unauthenticatedError() {
    return new GateError(401, "unauthenticated", accessCopy_1.AI_ACCESS_MESSAGES.signed_out);
}
function sessionExpiredError() {
    return new GateError(401, "session_expired", accessCopy_1.AI_ACCESS_MESSAGES.session_ended);
}
function paymentRequiredError() {
    return new GateError(402, "payment_required", accessCopy_1.AI_ACCESS_MESSAGES.payment_required);
}
function inputTooLongError() {
    return new GateError(429, "input_too_long", accessCopy_1.AI_ACCESS_MESSAGES.input_too_long);
}
function interviewsPausedError() {
    return new GateError(503, "interviews_paused", accessCopy_1.AI_ACCESS_MESSAGES.interviews_paused);
}
function appCheckError() {
    return new GateError(401, "app_check", accessCopy_1.AI_ACCESS_MESSAGES.app_check);
}
/**
 * TODO(v2.4.0 FR-16): enforce entitlements/{uid}.interviewsAllowed
 * (2 per purchase: 1 interview + 1 retake). Not implemented in this PR.
 * Stripe, the entitlements writer, and this counter are later PRs.
 * When added, increment usage/{uid}.interviewsUsed in the same transaction
 * style as the bridge daily cap and return 429 when the purchase is used up.
 * Pre-v2.4.0 saved results do not grant a free live-chat or interview exception.
 */
async function reserveInterviewSlot(_uid, _feature) {
    return;
}
function readHeader(req, name) {
    if (typeof req.header === "function") {
        const direct = req.header(name);
        if (typeof direct === "string" && direct.length > 0)
            return direct;
    }
    const headers = req.headers ?? {};
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(raw))
        return raw[0];
    return typeof raw === "string" ? raw : undefined;
}
function bearerToken(header) {
    if (!header)
        return null;
    const match = header.match(/^Bearer\s+(\S+)\s*$/i);
    return match ? match[1] : null;
}
//# sourceMappingURL=gate.js.map