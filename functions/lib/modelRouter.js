"use strict";
/**
 * Shared Gemini model routing for the chat proxy and the web client.
 *
 * HTTP 503 is capacity (high demand). Adding credits does not clear it.
 * HTTP 404 / "no longer available" means the model id is retired. Credits do not restore it.
 * HTTP 429 / quota / billing is the only case where adding credits helps.
 *
 * Retired ids observed on the project key (do not use them as backups):
 * - gemini-2.5-pro: 404 "no longer available to new users" (API names gemini-3.1-pro-preview)
 * - gemini-1.5-flash: 404 not found for generateContent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUESTABLE_GEMINI_MODELS = exports.DEFAULT_GEMINI_MODEL = exports.LIVE_GEMINI_MODELS = void 0;
exports.normalizeModelName = normalizeModelName;
exports.buildModelChain = buildModelChain;
exports.isRequestableModel = isRequestableModel;
exports.errorText = errorText;
exports.classifyModelError = classifyModelError;
exports.chainExhaustedMessage = chainExhaustedMessage;
exports.terminalModelMessage = terminalModelMessage;
exports.httpStatusForKind = httpStatusForKind;
exports.dominantFailureKind = dominantFailureKind;
exports.LIVE_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.8-flash",
];
exports.DEFAULT_GEMINI_MODEL = exports.LIVE_GEMINI_MODELS[0];
/** Ids a caller may request. Legacy ids are attempted once, then the live chain. */
exports.REQUESTABLE_GEMINI_MODELS = [
    ...exports.LIVE_GEMINI_MODELS,
    "gemini-2.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
];
function normalizeModelName(name) {
    const cleaned = String(name || "").trim().replace(/^models\//, "");
    return cleaned || exports.DEFAULT_GEMINI_MODEL;
}
function buildModelChain(requestedModel) {
    const requested = normalizeModelName(requestedModel);
    const chain = [];
    const push = (model) => {
        if (model && !chain.includes(model))
            chain.push(model);
    };
    push(requested);
    for (const model of exports.LIVE_GEMINI_MODELS)
        push(model);
    return chain.slice(0, 6);
}
function isRequestableModel(model) {
    return exports.REQUESTABLE_GEMINI_MODELS.includes(normalizeModelName(model));
}
function errorText(error) {
    if (!error)
        return "";
    if (typeof error === "string")
        return error;
    if (typeof error === "object") {
        const anyErr = error;
        return [
            anyErr.status,
            anyErr.code,
            anyErr.message,
            anyErr.error?.status,
            anyErr.error?.code,
            anyErr.error?.message,
        ]
            .filter((part) => part !== undefined && part !== null && String(part).length > 0)
            .join(" ");
    }
    return String(error);
}
function includesAny(msg, markers) {
    return markers.some((marker) => msg.includes(marker));
}
function classifyModelError(error) {
    const msg = errorText(error).toLowerCase();
    if (!msg)
        return "other";
    if (includesAny(msg, [
        "429",
        "quota",
        "resource_exhausted",
        "resource exhausted",
        "exceeded your current quota",
        "check your plan and billing",
        "spending cap",
    ])) {
        return "quota";
    }
    if (includesAny(msg, [
        "403",
        "api key",
        "permission denied",
        "unauthenticated",
        "credentials",
    ])) {
        return "auth";
    }
    // Retired ids must win over capacity markers. A 404 retry often closes the
    // websocket ("received 1000"), and "no longer available" is not UNAVAILABLE.
    if (includesAny(msg, [
        "404",
        "not_found",
        "not found",
        "no longer available",
        "not supported for generatecontent",
        "is not allowed",
        "not allowed",
    ])) {
        return "unavailable";
    }
    if (includesAny(msg, [
        "503",
        "high demand",
        "unavailable",
        "overloaded",
        "at capacity",
        "currently experiencing",
        "received 1000",
        "connection closed",
    ])) {
        return "capacity";
    }
    return "other";
}
function chainExhaustedMessage(failures) {
    const kinds = new Set(failures.map((failure) => failure.kind));
    const tried = failures.map((failure) => `${failure.model} (${failure.kind})`).join(", ") || "none";
    if (kinds.size === 1 && kinds.has("quota")) {
        return `Gemini quota or billing blocked every attempt (${tried}). Adding credits or raising quota will fix this.`;
    }
    if (kinds.size === 1 && kinds.has("auth")) {
        return `Gemini rejected credentials or project permissions (${tried}). This is not a capacity error and is not fixed by retries.`;
    }
    if (kinds.size === 1 && kinds.has("unavailable")) {
        return `Gemini model ids are retired or not found (${tried}). Adding credits will not restore a removed model.`;
    }
    if (kinds.has("capacity") && kinds.has("unavailable")) {
        return `Gemini fallback chain exhausted (${tried}). HTTP 503 is temporary capacity and is not fixed by credits. HTTP 404 means that model id is retired.`;
    }
    if (kinds.has("capacity")) {
        return `Gemini is at capacity (${tried}). HTTP 503 is temporary high demand and is not fixed by adding credits.`;
    }
    return `Gemini request failed (${tried}).`;
}
function terminalModelMessage(kind) {
    if (kind === "quota") {
        return "Error connecting to the stream. Gemini quota or billing blocked the request. Raising the quota or adding credits will fix this.";
    }
    if (kind === "auth") {
        return "Error connecting to the stream. Gemini rejected the credentials or project permissions. This is not a capacity error.";
    }
    if (kind === "unavailable") {
        return "Error connecting to the stream. The Gemini model is retired or not found (HTTP 404). Adding credits will not restore a removed model.";
    }
    if (kind === "capacity") {
        return "Error connecting to the stream. Gemini is at capacity (HTTP 503 high demand). This is temporary and is not fixed by adding credits.";
    }
    return "Error connecting to the stream.";
}
function httpStatusForKind(kind) {
    if (kind === "quota")
        return 429;
    if (kind === "auth")
        return 403;
    if (kind === "unavailable")
        return 404;
    if (kind === "capacity")
        return 503;
    return 500;
}
function dominantFailureKind(failures) {
    const kinds = failures.map((failure) => failure.kind);
    if (kinds.includes("quota"))
        return "quota";
    if (kinds.includes("auth"))
        return "auth";
    if (kinds.includes("capacity"))
        return "capacity";
    if (kinds.includes("unavailable"))
        return "unavailable";
    return "other";
}
//# sourceMappingURL=modelRouter.js.map