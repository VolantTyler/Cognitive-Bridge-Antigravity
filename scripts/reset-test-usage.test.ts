import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DATABASE_ID,
  FRESH_INTERVIEWS_ALLOWED,
  PAID_AT_SENTINEL,
  PROJECT_ID,
  TEST_ACCOUNT_EMAIL,
  ResetRefused,
  assertAuthRecord,
  auditDocId,
  commitAccountReset,
  createAllowlistedAuth,
  createFirestoreStore,
  isTestAccountEmail,
  loadResetOptions,
  parseDryRun,
  parseEmailList,
  parseResetPath,
  planReset,
  resetTestAccounts,
  type AccountSnapshot,
  type AdminDb,
  type AdminDocRef,
  type AdminSnapshot,
  type AdminTx,
  type AuthUser,
  type CommitInput,
  type ResetDeps,
  type ResetDoc,
  type ResetLogRecord,
  type ResetTx,
} from "./reset-test-usage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = "cos-stahl+cbtest1@mail.grokbot.com";
const ALLOWED_TWO = "cos-stahl+cbtest2@mail.grokbot.com";
const NOW = new Date("2026-11-12T20:00:00.000Z");
const RUN_ID = "4242.1";

const POSITIVE_EMAILS = [
  "cos-stahl+cbtest@mail.grokbot.com",
  "cos-stahl+cbtest1@mail.grokbot.com",
  "cos-stahl+cbtest-qa_2@mail.grokbot.com",
  "COS-STAHL+CBTEST1@MAIL.GROKBOT.COM",
  "cos-stahl+cbtest*@mail.grokbot.com",
];

const NEGATIVE_EMAILS = [
  "cos-stahl+cbtest1@mail.grokbot.com.evil.com",
  "cos-stahlx+cbtest1@mail.grokbot.com",
  "cbtest@other",
  "cbtest@other.com",
  "cos-stahl@mail.grokbot.com",
  "cos-stahl+notcbtest@mail.grokbot.com",
  "cos-stahl+cbtest1@gmail.com",
  "cos-stahl+cbtest1@mail.grokbot.co",
  "cos-stahl+cbtest1@evil.mail.grokbot.com",
  "xcos-stahl+cbtest1@mail.grokbot.com",
  "cos-stahl+cbtest1@mail.grokbot.com ",
  " cos-stahl+cbtest1@mail.grokbot.com",
  "cos-stahl+cbtest1@mail.grokbot.com\ncos-stahl+cbtest2@mail.grokbot.com",
  "*",
  "",
  "cos-stahl+cbtest1@mail.grokbot.com@mail.grokbot.com",
];

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    entitlement: {
      paid: true,
      provider: "stripe",
      sessionId: "cs_test",
      paymentIntentId: "pi_test",
      amount: 600,
      currency: "usd",
      interviewsAllowed: 2,
      activePaymentIntentIds: ["pi_test"],
      disputeStatus: "under_review",
      disputeId: "dp_1",
      paidAt: "2026-01-01T00:00:00.000Z",
    },
    interviews: {
      completedIds: ["iv_1", "iv_2"],
      active: { id: "iv_3", phase: "reserved", reservedAt: 1, startedAt: null },
    },
    ...overrides,
  };
}

function deps(partial: Partial<ResetDeps> & Pick<ResetDeps, "getUserByEmail">): {
  deps: ResetDeps;
  commits: CommitInput[];
  reads: string[];
} {
  const commits: CommitInput[] = [];
  const reads: string[] = [];
  return {
    commits,
    reads,
    deps: {
      readAccount: partial.readAccount ?? (async (uid) => {
        reads.push(uid);
        return snapshot();
      }),
      commit: partial.commit ?? (async (input) => {
        commits.push(input);
        throw new Error("commit should not run");
      }),
      log: partial.log ?? (() => undefined),
      getUserByEmail: partial.getUserByEmail,
    },
  };
}

describe("test account allowlist", () => {
  it("matches only the exact cbtest mailbox, including case differences", () => {
    for (const email of POSITIVE_EMAILS) {
      expect(TEST_ACCOUNT_EMAIL.test(email), email).toBe(true);
      expect(isTestAccountEmail(email), email).toBe(true);
    }
  });

  it("rejects look-alikes and other mailboxes", () => {
    for (const email of NEGATIVE_EMAILS) {
      expect(TEST_ACCOUNT_EMAIL.test(email), email).toBe(false);
      expect(isTestAccountEmail(email), email).toBe(false);
    }
    // Some regex engines let `$` match before a final newline. The gate used
    // before lookup and writes rejects CR/LF either way.
    expect(isTestAccountEmail(`${ALLOWED}\n`)).toBe(false);
    expect(isTestAccountEmail(`${ALLOWED}\r\n`)).toBe(false);
    expect(isTestAccountEmail(`${ALLOWED}\r`)).toBe(false);
  });

  it("refuses a non-matching email before Auth lookup or any write", async () => {
    let lookups = 0;
    let writes = 0;
    const harness = deps({
      async getUserByEmail() {
        lookups += 1;
        throw new Error("auth should not be called");
      },
      async commit() {
        writes += 1;
        throw new Error("commit should not be called");
      },
    });
    await expect(resetTestAccounts({
      emailsRaw: `${ALLOWED},cos-stahl+cbtest1@mail.grokbot.com.evil.com`,
      dryRun: false,
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
      deps: harness.deps,
    })).rejects.toThrow(/not on the test-account allowlist/);
    expect(lookups).toBe(0);
    expect(writes).toBe(0);
    expect(harness.reads).toEqual([]);

    expect(() => parseEmailList("cos-stahlx+cbtest1@mail.grokbot.com")).toThrow(ResetRefused);
    expect(() => parseEmailList("cbtest@other")).toThrow(ResetRefused);
    expect(() => parseEmailList("*")).toThrow(ResetRefused);
    expect(() => parseEmailList(`${ALLOWED},`)).toThrow(/empty entry/);
  });
});

describe("dry run", () => {
  it("lists current values and the fresh-purchase writes without writing", async () => {
    const lines: string[] = [];
    let writes = 0;
    const before = snapshot();
    const harness = deps({
      async getUserByEmail(email) {
        return { uid: email === ALLOWED_TWO ? "uidtwo" : "uidone", email };
      },
      async readAccount(uid) {
        harness.reads.push(uid);
        if (uid === "uidtwo") return { entitlement: null, interviews: null };
        return before;
      },
      async commit() {
        writes += 1;
        throw new Error("dry run wrote");
      },
      log(line) {
        lines.push(line);
      },
    });

    const records = await resetTestAccounts({
      emailsRaw: ` ${ALLOWED}, ${ALLOWED_TWO} `,
      dryRun: true,
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
      deps: harness.deps,
    });

    expect(writes).toBe(0);
    expect(harness.commits).toEqual([]);
    expect(harness.reads).toEqual(["uidone", "uidtwo"]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      event: "reset-test-usage",
      dryRun: true,
      email: ALLOWED,
      uid: "uidone",
      timestamp: NOW.toISOString(),
      runId: RUN_ID,
      databaseId: DATABASE_ID,
    });
    expect(records[0].before.interviews).toEqual(before.interviews);
    expect(records[0].before.entitlement).toMatchObject({
      interviewsAllowed: 2,
      disputeStatus: "under_review",
      sessionId: "cs_test",
    });
    expect(records[0].after.interviews).toEqual({ completedIds: [], active: null });
    expect(records[0].after.entitlement).toEqual({
      paid: true,
      provider: "stripe",
      interviewsAllowed: FRESH_INTERVIEWS_ALLOWED,
      disputeStatus: null,
      disputeId: null,
    });
    expect(records[0].after.entitlement).not.toHaveProperty("paidAt");
    expect(records[0].after.entitlement).not.toHaveProperty("sessionId");
    expect(records[1].after.entitlement.paidAt).toBe(PAID_AT_SENTINEL);
    expect(records[1].before).toEqual({ entitlement: null, interviews: null });

    const logged = lines.map((line) => JSON.parse(line) as ResetLogRecord);
    expect(logged[0].email).toBe(ALLOWED);
    expect(logged[0].uid).toBe("uidone");
    expect(logged[0].before).toEqual(records[0].before);
    expect(logged[0].after).toEqual(records[0].after);
    expect(logged[0].timestamp).toBe(NOW.toISOString());
    expect(logged[0].runId).toBe(RUN_ID);
    expect(logged.at(-1)).toMatchObject({ accounts: 2, wrote: false, dryRun: true });
  });

  it("writes nothing when no emails are provided, including a real-run flag", async () => {
    let lookups = 0;
    let writes = 0;
    const lines: string[] = [];
    const harness = deps({
      async getUserByEmail() {
        lookups += 1;
        return { uid: "uidone", email: ALLOWED };
      },
      async commit() {
        writes += 1;
        throw new Error("empty list wrote");
      },
      log(line) {
        lines.push(line);
      },
    });
    const records = await resetTestAccounts({
      emailsRaw: "  ",
      dryRun: false,
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
      deps: harness.deps,
    });
    expect(records).toEqual([]);
    expect(lookups).toBe(0);
    expect(writes).toBe(0);
    expect(JSON.parse(lines[0])).toMatchObject({ accounts: 0, wrote: false, message: "no emails provided; wrote nothing" });
  });

  it("defaults dry_run to true", () => {
    expect(parseDryRun(undefined)).toBe(true);
    expect(parseDryRun("")).toBe(true);
    expect(parseDryRun("true")).toBe(true);
    expect(parseDryRun(false)).toBe(false);
    expect(parseDryRun("false")).toBe(false);
    expect(() => parseDryRun("maybe")).toThrow(ResetRefused);
    const options = loadResetOptions([], {
      RESET_EMAILS: ALLOWED,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      FIRESTORE_DATABASE_ID: DATABASE_ID,
      GITHUB_RUN_ID: "4242",
      GITHUB_RUN_ATTEMPT: "3",
    }, NOW);
    expect(options.dryRun).toBe(true);
    expect(options.runId).toBe("4242.3");
    expect(options.projectId).toBe(PROJECT_ID);
    expect(options.databaseId).toBe(DATABASE_ID);
    expect(loadResetOptions(["--dry-run", "false"], {
      RESET_DRY_RUN: "true",
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
    }, NOW).dryRun).toBe(false);
    expect(() => loadResetOptions([], { FIRESTORE_DATABASE_ID: "(default)" }, NOW)).toThrow(/Firestore database/);
    expect(() => loadResetOptions([], { GOOGLE_CLOUD_PROJECT: "other-project" }, NOW)).toThrow(/Google Cloud project/);
  });
});

describe("auth re-check", () => {
  it("refuses an Auth email that fails the allowlist before reading or writing", async () => {
    let reads = 0;
    let writes = 0;
    const harness = deps({
      async getUserByEmail() {
        return { uid: "uidone", email: "cos-stahl+cbtest1@mail.grokbot.com.evil.com" };
      },
      async readAccount() {
        reads += 1;
        return snapshot();
      },
      async commit() {
        writes += 1;
        throw new Error("bad auth email wrote");
      },
    });
    await expect(resetTestAccounts({
      emailsRaw: ALLOWED,
      dryRun: false,
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
      deps: harness.deps,
    })).rejects.toThrow(/not on the test-account allowlist/);
    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(() => assertAuthRecord(ALLOWED, { uid: "uidone", email: "cos-stahlx+cbtest1@mail.grokbot.com" })).toThrow(ResetRefused);
    expect(() => assertAuthRecord(ALLOWED, { uid: "uidone", email: "cbtest@other" })).toThrow(ResetRefused);
    expect(() => assertAuthRecord(ALLOWED, { uid: "bad/uid", email: ALLOWED })).toThrow(/unexpected characters/);
  });

  it("does not query Auth for a rejected address and hides lookup error details", async () => {
    let lookups = 0;
    const lookup = createAllowlistedAuth({
      async getUserByEmail() {
        lookups += 1;
        throw new Error("-----BEGIN PRIVATE KEY-----\nsecret");
      },
    });
    await expect(lookup("cbtest@other")).rejects.toThrow(/not on the test-account allowlist/);
    expect(lookups).toBe(0);
    lookups = 0;
    const missing = createAllowlistedAuth({
      async getUserByEmail(email) {
        lookups += 1;
        const error = new Error(`no user ${email} private_key=hidden`);
        (error as Error & { code: string }).code = "auth/user-not-found";
        throw error;
      },
    });
    await expect(missing(ALLOWED)).rejects.toThrow(`no Firebase Auth user for ${ALLOWED}`);
    expect(lookups).toBe(1);
  });

  it("accepts an Auth email that differs only by case", () => {
    expect(assertAuthRecord(ALLOWED, {
      uid: "uidone",
      email: "COS-STAHL+CBTEST1@MAIL.GROKBOT.COM",
    })).toEqual({ email: "COS-STAHL+CBTEST1@MAIL.GROKBOT.COM", uid: "uidone" });
  });
});

describe("reset writes", () => {
  it("uses one transaction per user and writes only entitlement, usage, and the audit doc", async () => {
    const docs = new Map<string, Record<string, unknown>>([
      ["entitlements/uidone", {
        paid: true,
        provider: "stripe",
        sessionId: "cs_test",
        paymentIntentId: "pi_test",
        amount: 600,
        currency: "usd",
        interviewsAllowed: 2,
        activePaymentIntentIds: ["pi_test"],
        disputeStatus: "under_review",
        disputeId: "dp_1",
        refundedAt: "2026-02-01T00:00:00.000Z",
        paidAt: { toDate: () => new Date("2026-01-01T00:00:00.000Z") },
      }],
      ["usage/uidone", {
        bridgeChat: { day: "2026-11-12", count: 4 },
        interviews: {
          completedIds: ["iv_1", "iv_2"],
          active: { id: "iv_3", phase: "started", reservedAt: 1, startedAt: 2 },
        },
      }],
      ["usage_server/row", { uid: "uidone", promptTokens: 10 }],
      ["users/uidone", { mirrorMessages: [{ role: "user", content: "transcript" }] }],
    ]);
    let transactions = 0;
    let timestampCalls = 0;
    const sets: Array<{ path: string; data: Record<string, unknown>; merge: boolean }> = [];
    const db: AdminDb = {
      collection(name: string) {
        return {
          doc(id: string): AdminDocRef {
            const docPath = `${name}/${id}`;
            return {
              path: docPath,
              async get(): Promise<AdminSnapshot> {
                const data = docs.get(docPath);
                return {
                  exists: data !== undefined,
                  data: () => data,
                };
              },
            };
          },
        };
      },
      async runTransaction<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T> {
        transactions += 1;
        const tx: AdminTx = {
          async get(ref) {
            return ref.get();
          },
          set(ref, data, options) {
            const merge = options?.merge === true;
            sets.push({ path: ref.path, data, merge });
            const prev = docs.get(ref.path) ?? {};
            docs.set(ref.path, merge ? { ...prev, ...data } : { ...data });
          },
        };
        return fn(tx);
      },
    };
    const store = createFirestoreStore(db, () => {
      timestampCalls += 1;
      return { kind: "serverTimestamp" };
    });
    const lines: string[] = [];
    const records = await resetTestAccounts({
      emailsRaw: ALLOWED,
      dryRun: false,
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
      deps: {
        async getUserByEmail(email) {
          return { uid: "uidone", email } satisfies AuthUser;
        },
        readAccount(uid) {
          return store.readAccount(uid);
        },
        commit(input) {
          return store.commit(input);
        },
        log(line) {
          lines.push(line);
        },
      },
    });

    expect(transactions).toBe(1);
    expect(timestampCalls).toBe(0);
    expect(sets.map((entry) => entry.path)).toEqual([
      "entitlements/uidone",
      "usage/uidone",
      `admin_resets/${auditDocId(RUN_ID, "uidone")}`,
    ]);
    expect(sets[0].merge).toBe(true);
    expect(sets[1].merge).toBe(true);
    expect(sets[2].merge).toBe(false);
    expect(sets[0].data).toEqual({
      paid: true,
      provider: "stripe",
      interviewsAllowed: 2,
      disputeStatus: null,
      disputeId: null,
    });
    expect(sets[0].data).not.toHaveProperty("sessionId");
    expect(sets[0].data).not.toHaveProperty("paidAt");
    expect(sets[1].data).toEqual({ interviews: { completedIds: [], active: null } });
    expect(sets[1].data).not.toHaveProperty("bridgeChat");
    expect(sets.every((entry) => !entry.path.startsWith("usage_server/") && !entry.path.startsWith("users/"))).toBe(true);
    expect(docs.get("usage/uidone")).toEqual({
      bridgeChat: { day: "2026-11-12", count: 4 },
      interviews: { completedIds: [], active: null },
    });
    expect(docs.get("entitlements/uidone")).toMatchObject({
      paid: true,
      interviewsAllowed: 2,
      sessionId: "cs_test",
      paymentIntentId: "pi_test",
      activePaymentIntentIds: ["pi_test"],
      refundedAt: "2026-02-01T00:00:00.000Z",
      disputeStatus: null,
      disputeId: null,
    });
    expect(docs.get("usage_server/row")).toEqual({ uid: "uidone", promptTokens: 10 });
    expect(docs.get("users/uidone")).toEqual({ mirrorMessages: [{ role: "user", content: "transcript" }] });
    const audit = docs.get(`admin_resets/${auditDocId(RUN_ID, "uidone")}`);
    expect(audit).toMatchObject({
      schemaVersion: 1,
      email: ALLOWED,
      uid: "uidone",
      timestamp: NOW.toISOString(),
      runId: RUN_ID,
      databaseId: DATABASE_ID,
      dryRun: false,
    });
    expect(audit?.before).toMatchObject({
      interviews: { completedIds: ["iv_1", "iv_2"] },
    });
    expect((audit?.before as { entitlement: { paidAt: string } }).entitlement.paidAt).toBe("2026-01-01T00:00:00.000Z");
    expect(audit?.after).toEqual(records[0].after);
    expect(JSON.parse(lines[0])).toMatchObject({
      email: ALLOWED,
      uid: "uidone",
      dryRun: false,
      timestamp: NOW.toISOString(),
      runId: RUN_ID,
    });
    expect(JSON.parse(lines[1])).toMatchObject({ wrote: true, accounts: 1 });
  });

  it("writes a server timestamp for paidAt only on the entitlement document", async () => {
    const docs = new Map<string, Record<string, unknown>>();
    const sets: Array<{ path: string; data: Record<string, unknown> }> = [];
    const db: AdminDb = {
      collection(name: string) {
        return {
          doc(id: string): AdminDocRef {
            const docPath = `${name}/${id}`;
            return {
              path: docPath,
              async get() {
                const data = docs.get(docPath);
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      },
      async runTransaction(fn) {
        return fn({
          async get(ref) {
            return ref.get();
          },
          set(ref, data, options) {
            sets.push({ path: ref.path, data });
            const prev = docs.get(ref.path) ?? {};
            docs.set(ref.path, options?.merge ? { ...prev, ...data } : { ...data });
          },
        });
      },
    };
    const store = createFirestoreStore(db, () => ({ kind: "serverTimestamp" }));
    await store.commit({
      email: ALLOWED,
      uid: "uidone",
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
    });
    const entitlement = sets.find((entry) => entry.path === "entitlements/uidone");
    const audit = sets.find((entry) => entry.path.startsWith("admin_resets/"));
    expect(entitlement?.data.paidAt).toEqual({ kind: "serverTimestamp" });
    expect((audit?.data.after as { entitlement: { paidAt: string } }).entitlement.paidAt).toBe(PAID_AT_SENTINEL);
    expect(docs.get("usage_server/uidone")).toBeUndefined();
    expect(docs.get("users/uidone")).toBeUndefined();
  });

  it("sets paidAt only when the entitlement has none, inside the same transaction", async () => {
    const calls: string[] = [];
    const tx: ResetTx = {
      async get(docPath) {
        calls.push(`get ${docPath}`);
        return { exists: false, data: {} } satisfies ResetDoc;
      },
      set(docPath, data, options) {
        calls.push(`set ${docPath} merge=${options?.merge === true}`);
        if (docPath.startsWith("entitlements/")) {
          expect(data.paidAt).toBe(PAID_AT_SENTINEL);
          expect(data).not.toHaveProperty("sessionId");
        }
      },
    };
    const record = await commitAccountReset(tx, {
      email: ALLOWED,
      uid: "uidone",
      runId: RUN_ID,
      now: NOW,
      databaseId: DATABASE_ID,
    });
    expect(calls).toEqual([
      "get entitlements/uidone",
      "get usage/uidone",
      "set entitlements/uidone merge=true",
      "set usage/uidone merge=true",
      `set admin_resets/${auditDocId(RUN_ID, "uidone")} merge=false`,
    ]);
    expect(record.dryRun).toBe(false);
    expect(record.after.entitlement.paid).toBe(true);
    expect(record.after.entitlement.interviewsAllowed).toBe(2);
    expect(record.after.interviews).toEqual({ completedIds: [], active: null });
    expect(planReset(snapshot()).entitlement.paidAt).toBeUndefined();
    expect(planReset({ entitlement: { paid: true, paidAt: null }, interviews: null }).entitlement.paidAt).toBe(PAID_AT_SENTINEL);
  });

  it("refuses paths outside the three reset documents", () => {
    const auditId = auditDocId(RUN_ID, "uidone");
    expect(parseResetPath("entitlements/uidone", "uidone", auditId).collection).toBe("entitlements");
    expect(parseResetPath("usage/uidone", "uidone", auditId).collection).toBe("usage");
    expect(parseResetPath(`admin_resets/${auditId}`, "uidone", auditId).collection).toBe("admin_resets");
    expect(() => parseResetPath("users/uidone", "uidone", auditId)).toThrow(/unexpected document path/);
    expect(() => parseResetPath("usage_server/uidone", "uidone", auditId)).toThrow(/unexpected document path/);
    expect(() => parseResetPath("entitlements/someone-else", "uidone", auditId)).toThrow(/unexpected document path/);
    expect(() => parseResetPath("entitlements/uidone/secret", "uidone", auditId)).toThrow(/unexpected document path/);
    expect(() => auditDocId(RUN_ID, "uid/one")).toThrow(ResetRefused);
  });
});

describe("workflow", () => {
  it("is manual, defaults to dry run, and uses the deploy service account", () => {
    const workflow = readFileSync(path.join(HERE, "../.github/workflows/reset-test-usage.yml"), "utf8");
    const source = readFileSync(path.join(HERE, "reset-test-usage.ts"), "utf8");
    const checkout = readFileSync(path.join(HERE, "../functions/src/checkoutConfig.ts"), "utf8");
    const interviews = readFileSync(path.join(HERE, "../functions/src/interviews.ts"), "utf8");
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/dry_run:/);
    expect(workflow).toMatch(/type: boolean/);
    expect(workflow).toMatch(/default: true/);
    expect(workflow).toMatch(/emails:/);
    expect(workflow).not.toMatch(/^\s*(push|pull_request|schedule):/m);
    expect(workflow).toContain("secrets.FIREBASE_SERVICE_ACCOUNT_COGNITIVE_BRIDGE_AI");
    expect(workflow).toContain("google-github-actions/auth@v2");
    expect(workflow).toContain("credentials_json:");
    expect(workflow).toContain("project_id: cognitive-bridge-ai");
    expect(workflow).toContain("GOOGLE_CLOUD_PROJECT: cognitive-bridge-ai");
    expect(workflow).toContain("FIRESTORE_DATABASE_ID: ai-studio-10d489d8-3b32-488a-9698-e415f2608028");
    expect(workflow).toContain("npx tsx scripts/reset-test-usage.ts");
    expect(workflow).toContain("RESET_DRY_RUN: ${{ inputs.dry_run }}");
    expect(workflow).toContain("RESET_EMAILS: ${{ inputs.emails }}");
    expect(workflow).toContain("gh workflow run reset-test-usage.yml --repo VolantTyler/Cognitive-Bridge-Antigravity -f dry_run=true -f emails='cos-stahl+cbtest1@mail.grokbot.com'");
    expect(workflow).toContain("gh workflow run reset-test-usage.yml --repo VolantTyler/Cognitive-Bridge-Antigravity -f dry_run=false -f emails='cos-stahl+cbtest1@mail.grokbot.com'");
    expect(workflow).not.toMatch(/\becho\b/i);
    expect(workflow).not.toContain("listUsers");
    expect(source).not.toContain("listUsers");
    expect(source).not.toContain("collectionGroup");
    expect(source).not.toContain('collection("usage_server")');
    expect(source).not.toContain('collection("users")');
    expect(checkout).toMatch(/export const INTERVIEWS_ALLOWED = 2;/);
    expect(interviews).toMatch(/export const DEFAULT_INTERVIEWS_ALLOWED = 2;/);
    expect(FRESH_INTERVIEWS_ALLOWED).toBe(2);
  });
});
