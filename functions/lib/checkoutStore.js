"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFirestoreBillingStore = createFirestoreBillingStore;
const adminStore_1 = require("./adminStore");
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asStringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.length > 0);
}
function recordFromData(sessionId, data) {
    const uid = asString(data.uid);
    const outcome = asString(data.outcome);
    if (!uid || !outcome)
        return null;
    return {
        sessionId,
        uid,
        paymentIntentId: asString(data.paymentIntentId),
        billingCountry: asString(data.billingCountry),
        termsAccepted: data.termsAccepted === true,
        outcome: outcome,
        manualRefundRequired: data.manualRefundRequired === true,
        needsManualReview: data.needsManualReview === true,
        amount: asNumber(data.amount),
        currency: asString(data.currency),
    };
}
function entitlementFromData(data) {
    return {
        paid: data.paid === true,
        provider: "stripe",
        sessionId: asString(data.sessionId) ?? "",
        paymentIntentId: asString(data.paymentIntentId) ?? "",
        amount: asNumber(data.amount) ?? 0,
        currency: asString(data.currency) ?? "",
        interviewsAllowed: asNumber(data.interviewsAllowed) ?? 2,
        activePaymentIntentIds: asStringList(data.activePaymentIntentIds),
        disputeStatus: asString(data.disputeStatus),
        disputeId: asString(data.disputeId),
    };
}
function createFirestoreBillingStore(dbPromise = adminStore_1.getAdminFirestore) {
    return {
        async claimEvent(id, type) {
            const db = await dbPromise();
            const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
            const ref = db.collection("stripe_events").doc(id);
            return db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (snap.exists && snap.get("processed") === true)
                    return "duplicate";
                if (!snap.exists) {
                    tx.set(ref, {
                        type,
                        processed: false,
                        receivedAt: FieldValue.serverTimestamp(),
                    });
                }
                return "start";
            });
        },
        async completeEvent(id) {
            const db = await dbPromise();
            const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
            await db.collection("stripe_events").doc(id).set({
                processed: true,
                processedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        },
        async readEntitlement(uid) {
            const db = await dbPromise();
            const snap = await db.collection("entitlements").doc(uid).get();
            if (!snap.exists)
                return null;
            return entitlementFromData(snap.data() ?? {});
        },
        async writeEntitlement(uid, state, stamps) {
            const db = await dbPromise();
            const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
            const ref = db.collection("entitlements").doc(uid);
            const existing = await ref.get();
            const payload = { ...state, provider: "stripe" };
            if (stamps.paidAt && !existing.get("paidAt")) {
                payload.paidAt = FieldValue.serverTimestamp();
            }
            if (stamps.refundedAt) {
                payload.refundedAt = FieldValue.serverTimestamp();
            }
            await ref.set(payload, { merge: true });
        },
        async writeCheckoutConsent(consent) {
            const db = await dbPromise();
            const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
            await db.collection("checkout_consents").doc(consent.sessionId).set({
                uid: consent.uid,
                acceptedAt: FieldValue.serverTimestamp(),
                termsVersion: consent.termsVersion,
                attested18OrOlder: true,
                sessionId: consent.sessionId,
            });
        },
        async writeCheckoutRecord(record) {
            const db = await dbPromise();
            const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
            await db.collection("checkout_sessions").doc(record.sessionId).set({
                ...record,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        },
        async readCheckoutRecord(sessionId) {
            const db = await dbPromise();
            const snap = await db.collection("checkout_sessions").doc(sessionId).get();
            if (!snap.exists)
                return null;
            return recordFromData(sessionId, snap.data() ?? {});
        },
        async listCheckoutRecordsForUid(uid) {
            const db = await dbPromise();
            const snap = await db.collection("checkout_sessions").where("uid", "==", uid).limit(20).get();
            const records = [];
            for (const doc of snap.docs) {
                const record = recordFromData(doc.id, doc.data());
                if (record)
                    records.push(record);
            }
            return records;
        },
        async findCheckoutByPaymentIntent(paymentIntentId) {
            if (!paymentIntentId)
                return null;
            const db = await dbPromise();
            const snap = await db.collection("checkout_sessions")
                .where("paymentIntentId", "==", paymentIntentId)
                .limit(1)
                .get();
            const doc = snap.docs[0];
            if (!doc)
                return null;
            return recordFromData(doc.id, doc.data());
        },
    };
}
//# sourceMappingURL=checkoutStore.js.map