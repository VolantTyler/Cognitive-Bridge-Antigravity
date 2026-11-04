"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_ACCESS_CUTOFF_ISO = void 0;
exports.legacyCutoffMs = legacyCutoffMs;
exports.isLegacyAccess = isLegacyAccess;
/**
 * FR-E1. Legacy view access is the Firestore document createTime of
 * users/{uid}, which the client cannot write. A field inside the document
 * is not used, because the owner can update users/{uid}.
 *
 * Cutoff is midnight US Eastern on 2026-11-11 (the v2.4.0 target). Documents
 * created earlier keep view access. LEGACY_ACCESS_CUTOFF can move the instant
 * without a code change if launch slips. Deleting the user document and
 * creating it again resets createTime and drops legacy view access.
 */
exports.LEGACY_ACCESS_CUTOFF_ISO = "2026-11-11T05:00:00.000Z";
function legacyCutoffMs(env = process.env) {
    const raw = env.LEGACY_ACCESS_CUTOFF;
    if (typeof raw === "string" && raw.trim()) {
        const parsed = Date.parse(raw.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return Date.parse(exports.LEGACY_ACCESS_CUTOFF_ISO);
}
function isLegacyAccess(createTimeMs, cutoffMs = legacyCutoffMs()) {
    if (createTimeMs === null || !Number.isFinite(createTimeMs))
        return false;
    return createTimeMs < cutoffMs;
}
//# sourceMappingURL=legacyAccess.js.map