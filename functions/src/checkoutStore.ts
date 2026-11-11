import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "./adminStore";
import {
  BillingStore,
  CheckoutConsent,
  CheckoutRecord,
  EntitlementState,
  EntitlementStamps,
} from "./checkoutTypes";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function recordFromData(sessionId: string, data: DocumentData): CheckoutRecord | null {
  const uid = asString(data.uid);
  const outcome = asString(data.outcome);
  if (!uid || !outcome) return null;
  return {
    sessionId,
    uid,
    paymentIntentId: asString(data.paymentIntentId),
    billingCountry: asString(data.billingCountry),
    termsAccepted: data.termsAccepted === true,
    outcome: outcome as CheckoutRecord["outcome"],
    manualRefundRequired: data.manualRefundRequired === true,
    needsManualReview: data.needsManualReview === true,
    amount: asNumber(data.amount),
    currency: asString(data.currency),
  };
}

function entitlementFromData(data: DocumentData): EntitlementState {
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

export function createFirestoreBillingStore(dbPromise: () => Promise<Firestore> = getAdminFirestore): BillingStore {
  return {
    async claimEvent(id, type) {
      const db = await dbPromise();
      const { FieldValue } = await import("firebase-admin/firestore");
      const ref = db.collection("stripe_events").doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.get("processed") === true) return "duplicate" as const;
        if (!snap.exists) {
          tx.set(ref, {
            type,
            processed: false,
            receivedAt: FieldValue.serverTimestamp(),
          });
        }
        return "start" as const;
      });
    },
    async completeEvent(id) {
      const db = await dbPromise();
      const { FieldValue } = await import("firebase-admin/firestore");
      await db.collection("stripe_events").doc(id).set({
        processed: true,
        processedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
    async readEntitlement(uid) {
      const db = await dbPromise();
      const snap = await db.collection("entitlements").doc(uid).get();
      if (!snap.exists) return null;
      return entitlementFromData(snap.data() ?? {});
    },
    async writeEntitlement(uid, state, stamps: EntitlementStamps) {
      const db = await dbPromise();
      const { FieldValue } = await import("firebase-admin/firestore");
      const ref = db.collection("entitlements").doc(uid);
      const existing = await ref.get();
      const payload: Record<string, unknown> = { ...state, provider: "stripe" };
      if (stamps.paidAt && !existing.get("paidAt")) {
        payload.paidAt = FieldValue.serverTimestamp();
      }
      if (stamps.refundedAt) {
        payload.refundedAt = FieldValue.serverTimestamp();
      }
      await ref.set(payload, { merge: true });
    },
    async writeCheckoutConsent(consent: CheckoutConsent) {
      const db = await dbPromise();
      const { FieldValue } = await import("firebase-admin/firestore");
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
      const { FieldValue } = await import("firebase-admin/firestore");
      await db.collection("checkout_sessions").doc(record.sessionId).set({
        ...record,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
    async readCheckoutRecord(sessionId) {
      const db = await dbPromise();
      const snap = await db.collection("checkout_sessions").doc(sessionId).get();
      if (!snap.exists) return null;
      return recordFromData(sessionId, snap.data() ?? {});
    },
    async listCheckoutRecordsForUid(uid) {
      const db = await dbPromise();
      const snap = await db.collection("checkout_sessions").where("uid", "==", uid).limit(20).get();
      const records: CheckoutRecord[] = [];
      for (const doc of snap.docs) {
        const record = recordFromData(doc.id, doc.data());
        if (record) records.push(record);
      }
      return records;
    },
    async findCheckoutByPaymentIntent(paymentIntentId) {
      if (!paymentIntentId) return null;
      const db = await dbPromise();
      const snap = await db.collection("checkout_sessions")
        .where("paymentIntentId", "==", paymentIntentId)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (!doc) return null;
      return recordFromData(doc.id, doc.data());
    },
  };
}
