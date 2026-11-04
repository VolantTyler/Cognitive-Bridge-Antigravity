import type { Firestore } from "firebase-admin/firestore";
import { GateError, nextBridgeUsage } from "./gate";
import { UsageRecord } from "./usageLog";

export const DEFAULT_FIRESTORE_DATABASE_ID =
  "ai-studio-10d489d8-3b32-488a-9698-e415f2608028";

async function adminFirestore(): Promise<Firestore> {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (getApps().length === 0) {
    initializeApp();
  }
  const databaseId = process.env.FIRESTORE_DATABASE_ID || DEFAULT_FIRESTORE_DATABASE_ID;
  return getFirestore(getApps()[0], databaseId);
}

/**
 * entitlements/{uid}.paid === true (FR-9).
 * A users/{uid} profile saved before v2.4.0 is not an entitlement.
 * Live chat on those results stays paid-only when AI_GATE_MODE=paid.
 */
export async function readEntitlementPaid(uid: string): Promise<boolean> {
  const db = await adminFirestore();
  const snap = await db.collection("entitlements").doc(uid).get();
  return snap.exists && snap.get("paid") === true;
}

export async function reserveBridgeChatSlot(uid: string, day: string, cap: number): Promise<void> {
  const db = await adminFirestore();
  const ref = db.collection("usage").doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? snap.get("bridgeChat") as { day?: unknown; count?: unknown } | undefined
        : undefined;
      const next = nextBridgeUsage(existing, day, cap);
      tx.set(ref, { bridgeChat: next }, { merge: true });
    });
  } catch (error) {
    if (error instanceof GateError) throw error;
    console.error("usage counter transaction failed");
    throw error;
  }
}

export async function writeUsageRecord(record: UsageRecord): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
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

export async function verifyAppCheckToken(token: string): Promise<void> {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getAppCheck } = await import("firebase-admin/app-check");
  if (getApps().length === 0) initializeApp();
  await getAppCheck().verifyToken(token);
}
