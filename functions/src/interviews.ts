import { AI_ACCESS_MESSAGES } from "./accessCopy";
import { GateError } from "./gate";

/**
 * One completed interview is a Mirror run the user accepts (Keep, accept
 * corrections, or a preset). See interviewHttp.ts for the lease tradeoff.
 *
 * A reservation is "reserved" until chatProxy gets a successful model reply,
 * then "started". The lease is measured from reserve time until that reply,
 * then from the reply. An unused reservation expires without counting.
 * A started reservation that is never accepted counts when the lease ends.
 */
export const INTERVIEW_LEASE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_INTERVIEWS_ALLOWED = 2;

export type ReservationPhase = "reserved" | "started";

export interface ActiveReservation {
  id: string;
  phase: ReservationPhase;
  reservedAt: number;
  startedAt: number | null;
}

export interface InterviewLedger {
  completedIds: string[];
  active: ActiveReservation | null;
}

export interface EntitlementView {
  paid: boolean;
  interviewsAllowed: number;
}

export type InterviewDenial = "payment_required" | "interviews_exhausted";

export interface ReserveSuccess {
  ok: true;
  id: string;
  created: boolean;
  retake: boolean;
  remaining: number;
  ledger: InterviewLedger;
}

export interface ReserveFailure {
  ok: false;
  code: InterviewDenial;
  ledger: InterviewLedger;
}

export type ReserveOutcome = ReserveSuccess | ReserveFailure;

export function reserveDenied(outcome: ReserveOutcome): outcome is ReserveFailure {
  return outcome.ok === false;
}

export function emptyLedger(): InterviewLedger {
  return { completedIds: [], active: null };
}

export function parseLedger(value: unknown): InterviewLedger {
  if (!value || typeof value !== "object") return emptyLedger();
  const record = value as { completedIds?: unknown; active?: unknown };
  const completedIds = Array.isArray(record.completedIds)
    ? record.completedIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 80)
    : [];
  const active = parseActive(record.active);
  if (active && completedIds.includes(active.id)) {
    return { completedIds, active: null };
  }
  return { completedIds, active };
}

function parseActive(value: unknown): ActiveReservation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { id?: unknown; phase?: unknown; reservedAt?: unknown; startedAt?: unknown };
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 80) return null;
  if (record.phase !== "reserved" && record.phase !== "started") return null;
  if (typeof record.reservedAt !== "number" || !Number.isFinite(record.reservedAt)) return null;
  const startedAt = typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
    ? record.startedAt
    : null;
  return { id: record.id, phase: record.phase, reservedAt: record.reservedAt, startedAt };
}

function deadline(active: ActiveReservation, leaseMs: number): number {
  const basis = active.phase === "started" && active.startedAt !== null ? active.startedAt : active.reservedAt;
  return basis + leaseMs;
}

/** Drops an unused reservation. Commits a started one that outlived its lease. */
export function expireLedger(
  ledger: InterviewLedger,
  now: number,
  leaseMs: number = INTERVIEW_LEASE_MS
): InterviewLedger {
  const active = ledger.active;
  if (!active || now < deadline(active, leaseMs)) return ledger;
  if (active.phase === "reserved" || ledger.completedIds.includes(active.id)) {
    return { completedIds: ledger.completedIds, active: null };
  }
  return { completedIds: [...ledger.completedIds, active.id], active: null };
}

export function interviewsRemaining(ledger: InterviewLedger, allowed: number): number {
  const held = ledger.active ? 1 : 0;
  return Math.max(0, allowed - ledger.completedIds.length - held);
}

export function applyReserve(input: {
  entitlement: EntitlementView;
  ledger: InterviewLedger;
  now: number;
  newId: string;
  leaseMs?: number;
}): ReserveOutcome {
  const leaseMs = input.leaseMs ?? INTERVIEW_LEASE_MS;
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
  const active: ActiveReservation = {
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
export function applyMarkStarted(ledger: InterviewLedger, now: number, leaseMs: number = INTERVIEW_LEASE_MS): InterviewLedger {
  const current = expireLedger(ledger, now, leaseMs);
  if (!current.active || current.active.phase === "started") return current;
  return {
    completedIds: current.completedIds,
    active: { ...current.active, phase: "started", startedAt: now },
  };
}

export interface CompleteOutcome {
  ok: boolean;
  newlyCompleted: boolean;
  ledger: InterviewLedger;
}

/**
 * Accepting scores commits the open reservation. Repeating the same id does
 * not increment again. A missing reservation does not create one.
 */
export function applyComplete(
  ledger: InterviewLedger,
  reservationId: string | null,
  now: number,
  leaseMs: number = INTERVIEW_LEASE_MS
): CompleteOutcome {
  const current = expireLedger(ledger, now, leaseMs);
  if (reservationId && current.completedIds.includes(reservationId)) {
    return { ok: true, newlyCompleted: false, ledger: current };
  }
  const active = current.active;
  if (!active) return { ok: false, newlyCompleted: false, ledger: current };
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

export function denialError(code: InterviewDenial): GateError {
  if (code === "payment_required") {
    return new GateError(402, "payment_required", AI_ACCESS_MESSAGES.payment_required);
  }
  return new GateError(429, "interviews_exhausted", AI_ACCESS_MESSAGES.interviews_exhausted);
}
