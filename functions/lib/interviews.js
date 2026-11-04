"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_INTERVIEWS_ALLOWED = exports.INTERVIEW_LEASE_MS = void 0;
exports.reserveDenied = reserveDenied;
exports.emptyLedger = emptyLedger;
exports.parseLedger = parseLedger;
exports.expireLedger = expireLedger;
exports.interviewsRemaining = interviewsRemaining;
exports.applyReserve = applyReserve;
exports.applyMarkStarted = applyMarkStarted;
exports.applyComplete = applyComplete;
exports.denialError = denialError;
const accessCopy_1 = require("./accessCopy");
const gate_1 = require("./gate");
/**
 * One completed interview is a Mirror run the user accepts (Keep, accept
 * corrections, or a preset). See interviewHttp.ts for the lease tradeoff.
 *
 * A reservation is "reserved" until chatProxy gets a successful model reply,
 * then "started". The lease is measured from reserve time until that reply,
 * then from the reply. An unused reservation expires without counting.
 * A started reservation that is never accepted counts when the lease ends.
 */
exports.INTERVIEW_LEASE_MS = 6 * 60 * 60 * 1000;
exports.DEFAULT_INTERVIEWS_ALLOWED = 2;
function reserveDenied(outcome) {
    return outcome.ok === false;
}
function emptyLedger() {
    return { completedIds: [], active: null };
}
function parseLedger(value) {
    if (!value || typeof value !== "object")
        return emptyLedger();
    const record = value;
    const completedIds = Array.isArray(record.completedIds)
        ? record.completedIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 80)
        : [];
    const active = parseActive(record.active);
    if (active && completedIds.includes(active.id)) {
        return { completedIds, active: null };
    }
    return { completedIds, active };
}
function parseActive(value) {
    if (!value || typeof value !== "object")
        return null;
    const record = value;
    if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 80)
        return null;
    if (record.phase !== "reserved" && record.phase !== "started")
        return null;
    if (typeof record.reservedAt !== "number" || !Number.isFinite(record.reservedAt))
        return null;
    const startedAt = typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
        ? record.startedAt
        : null;
    return { id: record.id, phase: record.phase, reservedAt: record.reservedAt, startedAt };
}
function deadline(active, leaseMs) {
    const basis = active.phase === "started" && active.startedAt !== null ? active.startedAt : active.reservedAt;
    return basis + leaseMs;
}
/** Drops an unused reservation. Commits a started one that outlived its lease. */
function expireLedger(ledger, now, leaseMs = exports.INTERVIEW_LEASE_MS) {
    const active = ledger.active;
    if (!active || now < deadline(active, leaseMs))
        return ledger;
    if (active.phase === "reserved" || ledger.completedIds.includes(active.id)) {
        return { completedIds: ledger.completedIds, active: null };
    }
    return { completedIds: [...ledger.completedIds, active.id], active: null };
}
function interviewsRemaining(ledger, allowed) {
    const held = ledger.active ? 1 : 0;
    return Math.max(0, allowed - ledger.completedIds.length - held);
}
function applyReserve(input) {
    const leaseMs = input.leaseMs ?? exports.INTERVIEW_LEASE_MS;
    const ledger = expireLedger(input.ledger, input.now, leaseMs);
    if (!input.entitlement.paid) {
        return { ok: false, code: "payment_required", ledger };
    }
    const allowed = input.entitlement.interviewsAllowed;
    if (ledger.active) {
        return {
            ok: true,
            id: ledger.active.id,
            created: false,
            retake: ledger.completedIds.length > 0,
            remaining: interviewsRemaining(ledger, allowed),
            ledger,
        };
    }
    if (ledger.completedIds.length >= allowed) {
        return { ok: false, code: "interviews_exhausted", ledger };
    }
    const active = {
        id: input.newId,
        phase: "reserved",
        reservedAt: input.now,
        startedAt: null,
    };
    const next = { completedIds: ledger.completedIds, active };
    return {
        ok: true,
        id: active.id,
        created: true,
        retake: ledger.completedIds.length > 0,
        remaining: interviewsRemaining(next, allowed),
        ledger: next,
    };
}
/** Marks the open reservation started after a successful model reply. */
function applyMarkStarted(ledger, now, leaseMs = exports.INTERVIEW_LEASE_MS) {
    const current = expireLedger(ledger, now, leaseMs);
    if (!current.active || current.active.phase === "started")
        return current;
    return {
        completedIds: current.completedIds,
        active: { ...current.active, phase: "started", startedAt: now },
    };
}
/**
 * Accepting scores commits the open reservation. Repeating the same id does
 * not increment again. A missing reservation does not create one.
 */
function applyComplete(ledger, reservationId, now, leaseMs = exports.INTERVIEW_LEASE_MS) {
    const current = expireLedger(ledger, now, leaseMs);
    if (reservationId && current.completedIds.includes(reservationId)) {
        return { ok: true, newlyCompleted: false, ledger: current };
    }
    const active = current.active;
    if (!active)
        return { ok: false, newlyCompleted: false, ledger: current };
    if (reservationId && active.id !== reservationId) {
        return { ok: false, newlyCompleted: false, ledger: current };
    }
    if (current.completedIds.includes(active.id)) {
        return { ok: true, newlyCompleted: false, ledger: { completedIds: current.completedIds, active: null } };
    }
    return {
        ok: true,
        newlyCompleted: true,
        ledger: { completedIds: [...current.completedIds, active.id], active: null },
    };
}
function denialError(code) {
    if (code === "payment_required") {
        return new gate_1.GateError(402, "payment_required", accessCopy_1.AI_ACCESS_MESSAGES.payment_required);
    }
    return new gate_1.GateError(429, "interviews_exhausted", accessCopy_1.AI_ACCESS_MESSAGES.interviews_exhausted);
}
//# sourceMappingURL=interviews.js.map