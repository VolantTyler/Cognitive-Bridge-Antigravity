import { describe, expect, it } from "vitest";
import { AI_ACCESS_MESSAGES } from "./accessCopy";
import { memoryDb } from "./interviewStore";
import { completeInterviewSlot, readAccessView, reserveInterviewSlot } from "./interviewStore";
import {
  INTERVIEW_LEASE_MS,
  applyComplete,
  applyMarkStarted,
  applyReserve,
  emptyLedger,
  expireLedger,
  reserveDenied,
  type InterviewLedger,
} from "./interviews";
import { isLegacyAccess, LEGACY_ACCESS_CUTOFF_ISO } from "./legacyAccess";

const NOW = Date.parse("2026-11-12T15:00:00.000Z");
const PAID = { paid: true, interviewsAllowed: 2 };

function reserve(ledger: InterviewLedger, newId: string, now = NOW) {
  return applyReserve({ entitlement: PAID, ledger, now, newId });
}

describe("interview ledger", () => {
  it("does not burn a start that never receives a model reply", () => {
    const opened = reserve(emptyLedger(), "iv-1");
    expect(opened.ok).toBe(true);
    const expired = expireLedger(opened.ledger, NOW + INTERVIEW_LEASE_MS);
    expect(expired.completedIds).toEqual([]);
    expect(expired.active).toBeNull();
    const again = reserve(expired, "iv-2");
    expect(again.ok && again.created).toBe(true);
    expect(again.ledger.completedIds).toEqual([]);
  });

  it("commits an abandoned interview after the model has replied", () => {
    const opened = reserve(emptyLedger(), "iv-1");
    if (!opened.ok) throw new Error("expected reserve");
    const started = applyMarkStarted(opened.ledger, NOW + 1000);
    expect(started.active?.phase).toBe("started");
    const committed = expireLedger(started, NOW + 1000 + INTERVIEW_LEASE_MS);
    expect(committed.completedIds).toEqual(["iv-1"]);
    expect(committed.active).toBeNull();
    const blocked = applyReserve({ entitlement: PAID, ledger: committed, now: NOW + 1000 + INTERVIEW_LEASE_MS, newId: "iv-2" });
    expect(blocked.ok).toBe(true);
    if (blocked.ok) expect(blocked.remaining).toBe(0);
    const second = reserve(blocked.ok ? blocked.ledger : committed, "iv-3");
    expect(second.ok).toBe(true);
    const full = expireLedger(second.ledger, NOW + 1000 + INTERVIEW_LEASE_MS * 3);
    const third = applyReserve({
      entitlement: PAID,
      ledger: { completedIds: ["iv-1", "iv-2"], active: null },
      now: NOW,
      newId: "iv-3",
    });
    expect(full.active === null || full.completedIds.length >= 1).toBe(true);
    expect(reserveDenied(third) && third.code).toBe("interviews_exhausted");
  });

  it("reuses one open reservation and does not double-count accept", () => {
    const first = reserve(emptyLedger(), "iv-1");
    if (!first.ok) throw new Error("expected reserve");
    const second = reserve(first.ledger, "iv-2");
    expect(second.ok && second.created).toBe(false);
    expect(second.ok && second.id).toBe("iv-1");
    const accepted = applyComplete(first.ledger, "iv-1", NOW);
    expect(accepted.newlyCompleted).toBe(true);
    const repeat = applyComplete(accepted.ledger, "iv-1", NOW);
    expect(repeat.newlyCompleted).toBe(false);
    expect(repeat.ledger.completedIds).toEqual(["iv-1"]);
  });

  it("treats the second accepted interview as the retake and then stops", () => {
    const first = reserve(emptyLedger(), "iv-1");
    if (!first.ok) throw new Error("expected reserve");
    const done = applyComplete(applyMarkStarted(first.ledger, NOW), "iv-1", NOW);
    const retake = reserve(done.ledger, "iv-2");
    expect(retake.ok && retake.retake && retake.created).toBe(true);
    const both = applyComplete(retake.ledger, "iv-2", NOW);
    const extra = reserve(both.ledger, "iv-3");
    expect(extra.ok).toBe(false);
  });

  it("refuses a reserve when the account is not paid", () => {
    const result = applyReserve({
      entitlement: { paid: false, interviewsAllowed: 2 },
      ledger: emptyLedger(),
      now: NOW,
      newId: "iv-1",
    });
    expect(reserveDenied(result) && result.code).toBe("payment_required");
  });

  it("lets only one of two overlapping reserves create a slot when one remains", async () => {
    let current: InterviewLedger = { completedIds: ["done"], active: null };
    let version = 0;
    let waiting: Array<() => void> = [];
    const transaction = async (newId: string) => {
      while (true) {
        const seen = version;
        const computed = applyReserve({ entitlement: PAID, ledger: current, now: NOW, newId });
        await new Promise<void>((resolve) => waiting.push(resolve));
        if (version === seen) {
          current = computed.ledger;
          version += 1;
          return computed;
        }
      }
    };
    const first = transaction("race-1");
    const second = transaction("race-2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(waiting).toHaveLength(2);
    const wave = waiting.splice(0);
    wave.forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(waiting).toHaveLength(1);
    waiting.splice(0).forEach((release) => release());
    const [a, b] = await Promise.all([first, second]);
    const created = [a, b].filter((item) => item.ok && item.created);
    expect(created).toHaveLength(1);
    expect(current.active).not.toBeNull();
    expect(current.completedIds).toEqual(["done"]);
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
  });
});

describe("interview store", () => {
  function paidDb() {
    const rows = new Map<string, { data: Record<string, unknown>; createTimeMs: number | null }>();
    rows.set("entitlements/user-1", {
      data: { paid: true, interviewsAllowed: 2 },
      createTimeMs: null,
    });
    return memoryDb(rows);
  }

  it("stops at two completed interviews and reuses the open one", async () => {
    const db = paidDb();
    const first = await reserveInterviewSlot("user-1", NOW, db);
    expect(first.created).toBe(true);
    expect(first.id).not.toContain("user-1");
    const again = await reserveInterviewSlot("user-1", NOW + 1, db);
    expect(again.created).toBe(false);
    expect(again.id).toBe(first.id);
    await completeInterviewSlot("user-1", first.id, NOW + 2, db);
    const retake = await reserveInterviewSlot("user-1", NOW + 3, db);
    expect(retake.retake).toBe(true);
    await completeInterviewSlot("user-1", retake.id, NOW + 4, db);
    await expect(reserveInterviewSlot("user-1", NOW + 5, db)).rejects.toMatchObject({
      status: 429,
      code: "interviews_exhausted",
      message: AI_ACCESS_MESSAGES.interviews_exhausted,
    });
  });

  it("does not grant interview or legacy access from a client-shaped profile alone", async () => {
    const rows = new Map<string, { data: Record<string, unknown>; createTimeMs: number | null }>();
    rows.set("users/user-1", {
      data: { scores: { openness: 80 } },
      createTimeMs: Date.parse(LEGACY_ACCESS_CUTOFF_ISO),
    });
    const db = memoryDb(rows);
    const access = await readAccessView("user-1", db);
    expect(access.paid).toBe(false);
    expect(access.legacy).toBe(false);
    expect(access.interviewsRemaining).toBe(0);
    await expect(reserveInterviewSlot("user-1", NOW, db)).rejects.toMatchObject({ status: 402, code: "payment_required" });
  });

  it("marks a pre-cutoff user document as legacy without making it paid", async () => {
    const rows = new Map<string, { data: Record<string, unknown>; createTimeMs: number | null }>();
    rows.set("users/user-1", {
      data: { scores: { openness: 80 } },
      createTimeMs: Date.parse(LEGACY_ACCESS_CUTOFF_ISO) - 1,
    });
    const access = await readAccessView("user-1", memoryDb(rows));
    expect(access.legacy).toBe(true);
    expect(access.paid).toBe(false);
    expect(isLegacyAccess(null)).toBe(false);
  });
});
