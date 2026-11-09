"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAccessView = readAccessView;
exports.reserveInterviewSlot = reserveInterviewSlot;
exports.reserveInterviewForChat = reserveInterviewForChat;
exports.markInterviewStarted = markInterviewStarted;
exports.completeInterviewSlot = completeInterviewSlot;
exports.memoryDb = memoryDb;
exports.adaptFirestore = adaptFirestore;
const adminStore_1 = require("./adminStore");
const gate_1 = require("./gate");
const legacyAccess_1 = require("./legacyAccess");
const interviews_1 = require("./interviews");
function asNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
function entitlementFrom(snap) {
    if (!snap.exists || snap.get("paid") !== true) {
        return { paid: false, interviewsAllowed: 0 };
    }
    return {
        paid: true,
        interviewsAllowed: asNumber(snap.get("interviewsAllowed"), interviews_1.DEFAULT_INTERVIEWS_ALLOWED),
    };
}
function newReservationId(now) {
    return `iv_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function sameLedger(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function isDenial(value) {
    return value.ok === false && "code" in value;
}
async function mutate(db, uid, run) {
    return db.runTransaction(async (tx) => {
        const entSnap = await tx.get(db.doc(`entitlements/${uid}`));
        const useSnap = await tx.get(db.doc(`usage/${uid}`));
        const entitlement = entitlementFrom(entSnap);
        const ledger = (0, interviews_1.parseLedger)(useSnap.exists ? useSnap.get("interviews") : undefined);
        const outcome = run(entitlement, ledger);
        if (!sameLedger(ledger, outcome.ledger)) {
            tx.set(db.doc(`usage/${uid}`), { interviews: outcome.ledger }, { merge: true });
        }
        return outcome;
    });
}
async function readAccessView(uid, db) {
    const store = db ?? await firestoreDb();
    return store.runTransaction(async (tx) => {
        const entSnap = await tx.get(store.doc(`entitlements/${uid}`));
        const useSnap = await tx.get(store.doc(`usage/${uid}`));
        const userSnap = await tx.get(store.doc(`users/${uid}`));
        const entitlement = entitlementFrom(entSnap);
        const ledger = (0, interviews_1.parseLedger)(useSnap.exists ? useSnap.get("interviews") : undefined);
        const allowed = entitlement.paid ? entitlement.interviewsAllowed : 0;
        return {
            paid: entitlement.paid,
            legacy: (0, legacyAccess_1.isLegacyAccess)(userSnap.exists ? userSnap.createTimeMs : null, (0, legacyAccess_1.legacyCutoffMs)()),
            interviewsAllowed: allowed,
            interviewsCompleted: ledger.completedIds.length,
            interviewsRemaining: entitlement.paid ? (0, interviews_1.interviewsRemaining)(ledger, allowed) : 0,
            inProgress: ledger.active !== null,
        };
    });
}
async function reserveInterviewSlot(uid, now = Date.now(), db) {
    const store = db ?? await firestoreDb();
    const outcome = await mutate(store, uid, (entitlement, ledger) => (0, interviews_1.applyReserve)({
        entitlement,
        ledger,
        now,
        newId: newReservationId(now),
    }));
    if ((0, interviews_1.reserveDenied)(outcome))
        throw (0, interviews_1.denialError)(outcome.code);
    return outcome;
}
/**
 * Chat gate entry. Auth mode and the tester allowlist do not consume slots.
 * Paid mode uses the same transaction as reserveInterviewSlot.
 */
async function reserveInterviewForChat(uid, _feature) {
    const config = (0, gate_1.configFromEnv)();
    if (config.mode !== "paid" || config.allowlist.has(uid))
        return;
    await reserveInterviewSlot(uid, Date.now());
}
async function markInterviewStarted(uid, now = Date.now(), db) {
    const config = (0, gate_1.configFromEnv)();
    if (config.mode !== "paid" || config.allowlist.has(uid))
        return;
    const store = db ?? await firestoreDb();
    await mutate(store, uid, (entitlement, ledger) => {
        if (!entitlement.paid) {
            return { ok: false, code: "payment_required", ledger };
        }
        const next = (0, interviews_1.applyMarkStarted)(ledger, now);
        return {
            ok: true,
            id: next.active?.id ?? "",
            created: false,
            retake: next.completedIds.length > 0,
            remaining: (0, interviews_1.interviewsRemaining)(next, entitlement.interviewsAllowed),
            ledger: next,
        };
    });
}
async function completeInterviewSlot(uid, reservationId, now = Date.now(), db) {
    const store = db ?? await firestoreDb();
    const outcome = await mutate(store, uid, (entitlement, ledger) => {
        if (!entitlement.paid) {
            return { ok: false, code: "payment_required", ledger, newlyCompleted: false };
        }
        const result = (0, interviews_1.applyComplete)(ledger, reservationId, now);
        return { ...result, allowed: entitlement.interviewsAllowed };
    });
    if (isDenial(outcome))
        throw (0, interviews_1.denialError)(outcome.code);
    if (!outcome.ok) {
        throw new gate_1.GateError(409, "interview_not_active", "We couldn't save this interview. Try again.");
    }
    const completed = outcome.ledger.completedIds.length;
    const held = outcome.ledger.active ? 1 : 0;
    const allowed = "allowed" in outcome && typeof outcome.allowed === "number" ? outcome.allowed : interviews_1.DEFAULT_INTERVIEWS_ALLOWED;
    return {
        newlyCompleted: outcome.newlyCompleted,
        completed,
        remaining: Math.max(0, allowed - completed - held),
    };
}
function memoryDb(initial) {
    return {
        doc(path) {
            return { path };
        },
        async runTransaction(fn) {
            const tx = {
                async get(ref) {
                    const row = initial.get(ref.path);
                    return {
                        exists: row !== undefined,
                        get(field) {
                            return row?.data[field];
                        },
                        createTimeMs: row?.createTimeMs ?? null,
                    };
                },
                set(ref, data) {
                    const existing = initial.get(ref.path);
                    const merged = { ...(existing?.data ?? {}), ...data };
                    initial.set(ref.path, { data: merged, createTimeMs: existing?.createTimeMs ?? null });
                },
            };
            return fn(tx);
        },
    };
}
async function firestoreDb() {
    const db = await (0, adminStore_1.getAdminFirestore)();
    return adaptFirestore(db);
}
function adaptFirestore(db) {
    const refFor = (path) => {
        const [collection, id] = path.split("/");
        return db.collection(collection).doc(id);
    };
    const wrap = (tx) => ({
        async get(ref) {
            const snap = await tx.get(refFor(ref.path));
            return {
                exists: snap.exists,
                get(field) {
                    return snap.get(field);
                },
                createTimeMs: snap.createTime ? snap.createTime.toMillis() : null,
            };
        },
        set(ref, data, options) {
            tx.set(refFor(ref.path), data, options);
        },
    });
    return {
        doc(path) {
            return { path };
        },
        runTransaction(fn) {
            return db.runTransaction(async (tx) => fn(wrap(tx)));
        },
    };
}
//# sourceMappingURL=interviewStore.js.map