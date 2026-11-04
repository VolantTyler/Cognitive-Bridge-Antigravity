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
exports.DEFAULT_FIRESTORE_DATABASE_ID = void 0;
exports.readEntitlementPaid = readEntitlementPaid;
exports.reserveBridgeChatSlot = reserveBridgeChatSlot;
exports.writeUsageRecord = writeUsageRecord;
exports.readDailyCostMicros = readDailyCostMicros;
exports.addDailyCostFromUsage = addDailyCostFromUsage;
exports.verifyAppCheckToken = verifyAppCheckToken;
const gate_1 = require("./gate");
const pricing_1 = require("./pricing");
exports.DEFAULT_FIRESTORE_DATABASE_ID = "ai-studio-10d489d8-3b32-488a-9698-e415f2608028";
async function adminFirestore() {
    const { getApps, initializeApp } = await Promise.resolve().then(() => __importStar(require("firebase-admin/app")));
    const { getFirestore } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
    if (getApps().length === 0) {
        initializeApp();
    }
    const databaseId = process.env.FIRESTORE_DATABASE_ID || exports.DEFAULT_FIRESTORE_DATABASE_ID;
    return getFirestore(getApps()[0], databaseId);
}
/**
 * entitlements/{uid}.paid === true (FR-9).
 * A users/{uid} profile saved before v2.4.0 is not an entitlement.
 * Live chat on those results stays paid-only when AI_GATE_MODE=paid.
 */
async function readEntitlementPaid(uid) {
    const db = await adminFirestore();
    const snap = await db.collection("entitlements").doc(uid).get();
    return snap.exists && snap.get("paid") === true;
}
async function reserveBridgeChatSlot(uid, day, cap) {
    const db = await adminFirestore();
    const ref = db.collection("usage").doc(uid);
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const existing = snap.exists
                ? snap.get("bridgeChat")
                : undefined;
            const next = (0, gate_1.nextBridgeUsage)(existing, day, cap);
            tx.set(ref, { bridgeChat: next }, { merge: true });
        });
    }
    catch (error) {
        if (error instanceof gate_1.GateError)
            throw error;
        console.error("usage counter transaction failed");
        throw error;
    }
}
async function writeUsageRecord(record) {
    const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
    const db = await adminFirestore();
    await db.collection("usage_server").add({
        uid: record.uid,
        sessionId: record.sessionId,
        feature: record.feature,
        model: record.model,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        ts: record.ts ?? FieldValue.serverTimestamp(),
    });
}
async function readDailyCostMicros(uid, day) {
    const db = await adminFirestore();
    const snap = await db.collection("daily_cost").doc(uid).collection("days").doc(day).get();
    if (!snap.exists)
        return 0;
    const value = snap.get("usdMicros");
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
/**
 * Adds this call's priced cost onto daily_cost/{uid}/days/{easternDay}.
 * Uses FieldValue.increment. A concurrent call can pass the pre-check
 * before this write lands, so the total can overshoot the cap slightly.
 */
async function addDailyCostFromUsage(record, now = new Date()) {
    const micros = (0, pricing_1.costMicrosForUsage)(record);
    if (micros <= 0 || !record.uid)
        return;
    const { FieldValue } = await Promise.resolve().then(() => __importStar(require("firebase-admin/firestore")));
    const db = await adminFirestore();
    const day = (0, gate_1.usEasternDay)(now);
    await db.collection("daily_cost").doc(record.uid).collection("days").doc(day).set({
        usdMicros: FieldValue.increment(micros),
        day,
        uid: record.uid,
    }, { merge: true });
}
async function verifyAppCheckToken(token) {
    const { getApps, initializeApp } = await Promise.resolve().then(() => __importStar(require("firebase-admin/app")));
    const { getAppCheck } = await Promise.resolve().then(() => __importStar(require("firebase-admin/app-check")));
    if (getApps().length === 0)
        initializeApp();
    await getAppCheck().verifyToken(token);
}
//# sourceMappingURL=adminStore.js.map