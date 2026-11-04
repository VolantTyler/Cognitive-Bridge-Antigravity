import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardChat, guardJudge, GuardDeps } from "./guard";
import { GateError, configFromEnv } from "./gate";
import { AI_ACCESS_MESSAGES, costCapMessage, dailyCapMessage } from "./accessCopy";

const memory = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  added: [] as Record<string, unknown>[],
}));

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{ name: "[DEFAULT]" }],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
  getFirestore: () => ({
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return {
            id,
            path,
            async get() {
              const data = memory.store.get(path);
              return {
                exists: data !== undefined,
                get(field: string) {
                  return data?.[field];
                },
              };
            },
          };
        },
        async add(data: Record<string, unknown>) {
          memory.added.push(data);
        },
      };
    },
    async runTransaction(fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; get: (field: string) => unknown }>;
      set: (ref: { path: string }, data: Record<string, unknown>, options: { merge: boolean }) => void;
    }) => Promise<void>) {
      await fn({
        async get(ref) {
          const data = memory.store.get(ref.path);
          return {
            exists: data !== undefined,
            get(field: string) {
              return data?.[field];
            },
          };
        },
        set(ref, data) {
          memory.store.set(ref.path, { ...(memory.store.get(ref.path) ?? {}), ...data });
        },
      });
    },
  }),
}));

import { readEntitlementPaid, reserveBridgeChatSlot, writeUsageRecord } from "./adminStore";

function deps(env: NodeJS.ProcessEnv, overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    config: () => configFromEnv(env),
    verifyIdToken: async () => ({ uid: "user-1", email: "a@example.com", email_verified: true }),
    readPaid: vi.fn(async () => false),
    reserveBridgeChat: vi.fn(async (uid: string, day: string, cap: number) => {
      await reserveBridgeChatSlot(uid, day, cap);
    }),
    reserveInterview: vi.fn(async () => {}),
    assertUnderCostCap: vi.fn(async () => {}),
    verifyAppCheck: vi.fn(async () => {}),
    now: () => new Date("2026-11-05T15:00:00.000Z"),
    ...overrides,
  };
}

const chatBody = {
  messages: [{ role: "user", content: "hello" }],
  feature: "playground-aligned",
  sessionId: "session_1",
};

describe("guard modes", () => {
  beforeEach(() => {
    memory.store.clear();
    memory.added.length = 0;
  });

  it("auth mode requires a verified token and does not read entitlements", async () => {
    const gate = deps({ AI_GATE_MODE: "auth" });
    await expect(guardChat({ method: "POST", body: chatBody }, gate)).rejects.toMatchObject({
      code: "unauthenticated",
    });

    const allowed = await guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, gate);
    expect(allowed.uid).toBe("user-1");
    expect(allowed.email).toBe("a@example.com");
    expect(allowed.email_verified).toBe(true);
    expect(gate.readPaid).not.toHaveBeenCalled();
    expect(gate.reserveBridgeChat).toHaveBeenCalledTimes(1);
  });

  it("paid mode requires entitlements/{uid}.paid and the allowlist bypasses only that check", async () => {
    const readPaid = vi.fn(async () => false);
    const unpaid = deps({ AI_GATE_MODE: "paid", AI_ALLOWLIST_UIDS: "" }, { readPaid });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, unpaid)).rejects.toMatchObject({ status: 402, code: "payment_required", message: AI_ACCESS_MESSAGES.payment_required });
    expect(unpaid.reserveInterview).not.toHaveBeenCalled();

    readPaid.mockResolvedValueOnce(true);
    const paid = await guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { ...chatBody, feature: "mirror" },
    }, unpaid);
    expect(paid.uid).toBe("user-1");

    const allowlisted = deps({ AI_GATE_MODE: "paid", AI_ALLOWLIST_UIDS: "user-1" }, {
      readPaid: vi.fn(async () => false),
    });
    await expect(guardChat({ method: "POST", body: chatBody }, allowlisted)).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    const skipped = await guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, allowlisted);
    expect(skipped.uid).toBe("user-1");
    expect(allowlisted.readPaid).not.toHaveBeenCalled();
  });

  it("paid mode lets the interview counter reject a third run", async () => {
    const reserveInterview = vi.fn(async () => {
      throw new GateError(429, "interviews_exhausted", AI_ACCESS_MESSAGES.interviews_exhausted);
    });
    const gate = deps({ AI_GATE_MODE: "paid" }, {
      readPaid: async () => true,
      reserveInterview,
    });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { messages: [{ content: "hi" }], feature: "mirror" },
    }, gate)).rejects.toMatchObject({
      status: 429,
      code: "interviews_exhausted",
      message: AI_ACCESS_MESSAGES.interviews_exhausted,
    });
    expect(reserveInterview).toHaveBeenCalledWith("user-1", "mirror");
  });

  it("applies the dollar cap to interview and judge calls, not only bridge chat", async () => {
    const assertUnderCostCap = vi.fn(async () => {
      throw new GateError(429, "cost_cap_reached", costCapMessage());
    });
    const gate = deps({ AI_GATE_MODE: "paid" }, { readPaid: async () => true, assertUnderCostCap });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { messages: [{ content: "hi" }], feature: "mirror" },
    }, gate)).rejects.toMatchObject({ status: 429, code: "cost_cap_reached", message: costCapMessage() });
    await expect(guardJudge({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { feature: "judge" },
    }, gate)).rejects.toMatchObject({ code: "cost_cap_reached", message: costCapMessage() });
    expect(costCapMessage()).toBe(
      "You've reached today's usage limit. It resets at midnight US Eastern. Your results are still here."
    );
    expect(dailyCapMessage()).toMatch(/chat limit/);
    expect(costCapMessage()).not.toMatch(/chat limit/);
  });

  it("applies the dollar cap to allowlisted uids and does not spend a bridge slot when blocked", async () => {
    const assertUnderCostCap = vi.fn(async () => {
      throw new GateError(429, "cost_cap_reached", costCapMessage());
    });
    const gate = deps({ AI_GATE_MODE: "paid", AI_ALLOWLIST_UIDS: "user-1" }, { assertUnderCostCap });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, gate)).rejects.toMatchObject({ status: 429, code: "cost_cap_reached" });
    expect(gate.reserveBridgeChat).not.toHaveBeenCalled();
    expect(gate.readPaid).not.toHaveBeenCalled();
  });

  it("off mode skips auth and the daily cap", async () => {
    const gate = deps({ AI_GATE_MODE: "off" });
    const ctx = await guardChat({ method: "POST", body: chatBody }, gate);
    expect(ctx.uid).toBeNull();
    expect(gate.reserveBridgeChat).not.toHaveBeenCalled();
  });

  it("enforces the character cap and the bridge daily cap without counting interviews", async () => {
    const gate = deps({ AI_GATE_MODE: "auth", BRIDGE_CHAT_DAILY_CAP: "1", MAX_INPUT_CHARS: "5" });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { messages: [{ content: "123456" }], feature: "bridge" },
    }, gate)).rejects.toMatchObject({ status: 429, code: "input_too_long" });
    expect(gate.reserveBridgeChat).not.toHaveBeenCalled();

    const roomy = deps({ AI_GATE_MODE: "auth", BRIDGE_CHAT_DAILY_CAP: "1" });
    await guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, roomy);
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: chatBody,
    }, roomy)).rejects.toBeInstanceOf(GateError);

    const interview = deps({ AI_GATE_MODE: "auth" });
    await guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { messages: [{ content: "hi" }], feature: "mirror", sessionId: "bad id" },
    }, interview);
    expect(interview.reserveBridgeChat).not.toHaveBeenCalled();
    expect(interview.reserveInterview).toHaveBeenCalledWith("user-1", "mirror");
  });

  it("pauses interview features with 503 and can require App Check", async () => {
    const paused = deps({ AI_GATE_MODE: "auth", INTERVIEWS_PAUSED: "true" });
    await expect(guardChat({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { messages: [{ content: "hi" }], feature: "mirror" },
    }, paused)).rejects.toMatchObject({
      status: 503,
      code: "interviews_paused",
      message: AI_ACCESS_MESSAGES.interviews_paused,
    });
    await expect(guardJudge({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { feature: "bridge", sessionId: "sess" },
    }, paused)).resolves.toMatchObject({ feature: "bridge" });

    const checked = deps({ AI_GATE_MODE: "auth", ENFORCE_APP_CHECK: "true" }, {
      verifyAppCheck: vi.fn(async () => {
        throw new Error("reject super-secret-appcheck");
      }),
    });
    try {
      await guardChat({
        method: "POST",
        headers: { authorization: "Bearer token", "x-firebase-appcheck": "super-secret-appcheck" },
        body: chatBody,
      }, checked);
      throw new Error("expected app check failure");
    } catch (error) {
      expect(error).toMatchObject({ status: 401, code: "app_check" });
      expect((error as Error).message).not.toContain("super-secret-appcheck");
    }
  });
});

describe("admin store", () => {
  beforeEach(() => {
    memory.store.clear();
    memory.added.length = 0;
  });

  it("reads only entitlements.paid and writes usage without message text", async () => {
    expect(await readEntitlementPaid("user-1")).toBe(false);
    memory.store.set("entitlements/user-1", { paid: true, provider: "stripe" });
    expect(await readEntitlementPaid("user-1")).toBe(true);
    memory.store.set("users/user-1", { scores: { openness: 1 } });
    expect(await readEntitlementPaid("someone-else")).toBe(false);

    await reserveBridgeChatSlot("user-1", "2026-11-04", 1);
    await expect(reserveBridgeChatSlot("user-1", "2026-11-04", 1)).rejects.toMatchObject({ code: "rate_limited" });

    await writeUsageRecord({
      uid: "user-1",
      sessionId: "sess",
      feature: "mirror",
      model: "gemini-2.5-flash",
      promptTokens: 3,
      completionTokens: 4,
    });
    expect(memory.added[0]).toEqual({
      uid: "user-1",
      sessionId: "sess",
      feature: "mirror",
      model: "gemini-2.5-flash",
      promptTokens: 3,
      completionTokens: 4,
      ts: "SERVER_TS",
    });
    expect(JSON.stringify(memory.added[0])).not.toContain("message");
  });
});
