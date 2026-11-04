"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadGateConfig = loadGateConfig;
const params_1 = require("firebase-functions/params");
const accessCopy_1 = require("./accessCopy");
const gate_1 = require("./gate");
const aiGateMode = (0, params_1.defineString)("AI_GATE_MODE", {
    default: "auth",
    description: "off | auth | paid. Default auth requires a Firebase ID token. paid also requires entitlements/{uid}.paid.",
});
const aiAllowlist = (0, params_1.defineString)("AI_ALLOWLIST_UIDS", {
    default: "",
    description: "Comma-separated Firebase uids that skip the entitlement check in paid mode.",
});
const enforceAppCheck = (0, params_1.defineString)("ENFORCE_APP_CHECK", {
    default: "false",
    description: "When true, /api/chat and /api/judge require a valid App Check token.",
});
const interviewsPaused = (0, params_1.defineString)("INTERVIEWS_PAUSED", {
    default: "false",
    description: "When true, interview features (mirror) return 503 interviews_paused.",
});
const bridgeDailyCap = (0, params_1.defineInt)("BRIDGE_CHAT_DAILY_CAP", {
    default: accessCopy_1.DEFAULT_BRIDGE_CHAT_DAILY_CAP,
    description: "Max bridge chat requests per uid per US Eastern day.",
});
const maxInputChars = (0, params_1.defineInt)("MAX_INPUT_CHARS", {
    default: accessCopy_1.DEFAULT_MAX_INPUT_CHARS,
    description: "Max combined input characters per chat request.",
});
function paramOrEnv(envValue, read) {
    if (envValue !== undefined)
        return envValue;
    try {
        return read();
    }
    catch {
        return undefined;
    }
}
/** Env vars win so tests and the emulator can override deployed params. */
function loadGateConfig(env = process.env) {
    return (0, gate_1.configFromEnv)({
        ...env,
        AI_GATE_MODE: paramOrEnv(env.AI_GATE_MODE, () => aiGateMode.value()),
        AI_ALLOWLIST_UIDS: paramOrEnv(env.AI_ALLOWLIST_UIDS, () => aiAllowlist.value()),
        ENFORCE_APP_CHECK: paramOrEnv(env.ENFORCE_APP_CHECK, () => enforceAppCheck.value()),
        INTERVIEWS_PAUSED: paramOrEnv(env.INTERVIEWS_PAUSED, () => interviewsPaused.value()),
        BRIDGE_CHAT_DAILY_CAP: paramOrEnv(env.BRIDGE_CHAT_DAILY_CAP, () => String(bridgeDailyCap.value())),
        MAX_INPUT_CHARS: paramOrEnv(env.MAX_INPUT_CHARS, () => String(maxInputChars.value())),
    });
}
//# sourceMappingURL=params.js.map