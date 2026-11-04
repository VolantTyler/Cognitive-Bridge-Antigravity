import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getAdminFirestore } from "./adminStore";
import { GateError, configFromEnv } from "./gate";
import { isLegacyAccess, legacyCutoffMs } from "./legacyAccess";
import {
  DEFAULT_INTERVIEWS_ALLOWED,
  EntitlementView,
  InterviewLedger,
  ReserveOutcome,
  ReserveSuccess,
  applyComplete,
  applyMarkStarted,
  applyReserve,
  denialError,
  reserveDenied,
  interviewsRemaining,
  parseLedger,
} from "./interviews";

export interface AccessView {
  paid: boolean;
  legacy: boolean;
  interviewsAllowed: number;
  interviewsCompleted: number;
  interviewsRemaining: number;
  inProgress: boolean;
}

export interface TxDoc {
  exists: boolean;
  get(field: string): unknown;
  createTimeMs: number | null;
}

export interface InterviewTx {
  get(ref: DocRef): Promise<TxDoc>;
  set(ref: DocRef, data: Record<string, unknown>, options: { merge: boolean }): void;
}

export interface DocRef {
  path: string;
}

export interface InterviewDb {
  doc(path: string): DocRef;
  runTransaction<T>(fn: (tx: InterviewTx) => Promise<T>): Promise<T>;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function entitlementFrom(snap: TxDoc): EntitlementView {
  if (!snap.exists || snap.get("paid") !== true) {
    return { paid: false, interviewsAllowed: 0 };
  }
  return {
    paid: true,
    interviewsAllowed: asNumber(snap.get("interviewsAllowed"), DEFAULT_INTERVIEWS_ALLOWED),
  };
}

function newReservationId(now: number): string {
  return `iv_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sameLedger(left: InterviewLedger, right: InterviewLedger): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isDenial(value: ReserveOutcome | { ok: boolean }): value is Extract<ReserveOutcome, { ok: false }> {
  return value.ok === false && "code" in value;
}

async function mutate<T extends { ok: boolean; ledger: InterviewLedger }>(
  db: InterviewDb,
  uid: string,
  run: (entitlement: EntitlementView, ledger: InterviewLedger) => T
): Promise<T> {
  return db.runTransaction(async (tx) => {
    const entSnap = await tx.get(db.doc(`entitlements/${uid}`));
    const useSnap = await tx.get(db.doc(`usage/${uid}`));
    const entitlement = entitlementFrom(entSnap);
    const ledger = parseLedger(useSnap.exists ? useSnap.get("interviews") : undefined);
    const outcome = run(entitlement, ledger);
    if (!sameLedger(ledger, outcome.ledger)) {
      tx.set(db.doc(`usage/${uid}`), { interviews: outcome.ledger }, { merge: true });
    }
    return outcome;
  });
}

export async function readAccessView(uid: string, db?: InterviewDb): Promise<AccessView> {
  const store = db ?? await firestoreDb();
  return store.runTransaction(async (tx) => {
    const entSnap = await tx.get(store.doc(`entitlements/${uid}`));
    const useSnap = await tx.get(store.doc(`usage/${uid}`));
    const userSnap = await tx.get(store.doc(`users/${uid}`));
    const entitlement = entitlementFrom(entSnap);
    const ledger = parseLedger(useSnap.exists ? useSnap.get("interviews") : undefined);
    const allowed = entitlement.paid ? entitlement.interviewsAllowed : 0;
    return {
      paid: entitlement.paid,
      legacy: isLegacyAccess(userSnap.exists ? userSnap.createTimeMs : null, legacyCutoffMs()),
      interviewsAllowed: allowed,
      interviewsCompleted: ledger.completedIds.length,
      interviewsRemaining: entitlement.paid ? interviewsRemaining(ledger, allowed) : 0,
      inProgress: ledger.active !== null,
    };
  });
}

export async function reserveInterviewSlot(uid: string, now: number = Date.now(), db?: InterviewDb): Promise<ReserveSuccess> {
  const store = db ?? await firestoreDb();
  const outcome = await mutate(store, uid, (entitlement, ledger) => applyReserve({
    entitlement,
    ledger,
    now,
    newId: newReservationId(now),
  }));
  if (reserveDenied(outcome)) throw denialError(outcome.code);
  return outcome;
}

/**
 * Chat gate entry. Auth mode and the tester allowlist do not consume slots.
 * Paid mode uses the same transaction as reserveInterviewSlot.
 */
export async function reserveInterviewForChat(uid: string, _feature: string): Promise<void> {
  const config = configFromEnv();
  if (config.mode !== "paid" || config.allowlist.has(uid)) return;
  await reserveInterviewSlot(uid, Date.now());
}

export async function markInterviewStarted(uid: string, now: number = Date.now(), db?: InterviewDb): Promise<void> {
  const config = configFromEnv();
  if (config.mode !== "paid" || config.allowlist.has(uid)) return;
  const store = db ?? await firestoreDb();
  await mutate(store, uid, (entitlement, ledger) => {
    if (!entitlement.paid) {
      return { ok: false as const, code: "payment_required" as const, ledger };
    }
    const next = applyMarkStarted(ledger, now);
    return {
      ok: true as const,
      id: next.active?.id ?? "",
      created: false,
      retake: next.completedIds.length > 0,
      remaining: interviewsRemaining(next, entitlement.interviewsAllowed),
      ledger: next,
    };
  });
}

export async function completeInterviewSlot(
  uid: string,
  reservationId: string | null,
  now: number = Date.now(),
  db?: InterviewDb
): Promise<{ newlyCompleted: boolean; remaining: number; completed: number }> {
  const store = db ?? await firestoreDb();
  const outcome = await mutate(store, uid, (entitlement, ledger) => {
    if (!entitlement.paid) {
      return { ok: false as const, code: "payment_required" as const, ledger, newlyCompleted: false };
    }
    const result = applyComplete(ledger, reservationId, now);
    return { ...result, allowed: entitlement.interviewsAllowed };
  });
  if (isDenial(outcome)) throw denialError(outcome.code);
  if (!outcome.ok) {
    throw new GateError(409, "interview_not_active", "We couldn't save this interview. Try again.");
  }
  const completed = outcome.ledger.completedIds.length;
  const held = outcome.ledger.active ? 1 : 0;
  const allowed = "allowed" in outcome && typeof outcome.allowed === "number" ? outcome.allowed : DEFAULT_INTERVIEWS_ALLOWED;
  return {
    newlyCompleted: outcome.newlyCompleted,
    completed,
    remaining: Math.max(0, allowed - completed - held),
  };
}

export function memoryDb(initial: Map<string, { data: Record<string, unknown>; createTimeMs: number | null }>): InterviewDb {
  return {
    doc(path: string) {
      return { path };
    },
    async runTransaction(fn) {
      const tx: InterviewTx = {
        async get(ref) {
          const row = initial.get(ref.path);
          return {
            exists: row !== undefined,
            get(field: string) {
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

async function firestoreDb(): Promise<InterviewDb> {
  const db = await getAdminFirestore();
  return adaptFirestore(db);
}

export function adaptFirestore(db: Firestore): InterviewDb {
  const refFor = (path: string) => {
    const [collection, id] = path.split("/");
    return db.collection(collection).doc(id);
  };
  const wrap = (tx: Transaction): InterviewTx => ({
    async get(ref) {
      const snap = await tx.get(refFor(ref.path));
      return {
        exists: snap.exists,
        get(field: string) {
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
    doc(path: string) {
      return { path };
    },
    runTransaction(fn) {
      return db.runTransaction(async (tx) => fn(wrap(tx)));
    },
  };
}
