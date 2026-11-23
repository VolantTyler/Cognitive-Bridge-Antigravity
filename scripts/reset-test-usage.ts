/**
 * Reset interview usage for Cognitive Bridge QA accounts.
 *
 * Allowlist, case-insensitive, exact:
 *   /^cos-stahl\+cbtest[^@]*@mail\.grokbot\.com$/i
 *
 * A checkout grant (functions/src/checkoutEvents.ts) writes
 * entitlements/{uid}.interviewsAllowed = 2 (INTERVIEWS_ALLOWED) and does not
 * touch usage/{uid}.interviews. An account that already completed 2 interviews
 * stays exhausted. This script restores the interview state of a first
 * purchase: paid, interviewsAllowed 2, and an empty interview ledger.
 *
 * Per user, one Firestore transaction writes only:
 *   entitlements/{uid}   allowance fields (merge; Stripe ids are kept)
 *   usage/{uid}          interviews: { completedIds: [], active: null } (merge)
 *   admin_resets/{id}    audit record
 *
 * It does not delete users/{uid} transcripts, usage_server rows, daily_cost,
 * checkout records, or bridgeChat. Dry run reads and logs, then writes nothing.
 *
 *   npx tsx scripts/reset-test-usage.ts --dry-run true --emails a@...
 *   npx tsx scripts/reset-test-usage.ts --dry-run false --emails a@...
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_ACCOUNT_EMAIL = /^cos-stahl\+cbtest[^@]*@mail\.grokbot\.com$/i;
export const PROJECT_ID = "cognitive-bridge-ai";
export const DATABASE_ID = "ai-studio-10d489d8-3b32-488a-9698-e415f2608028";
/** Matches functions/src/checkoutConfig.ts INTERVIEWS_ALLOWED and interviews.ts DEFAULT_INTERVIEWS_ALLOWED. */
export const FRESH_INTERVIEWS_ALLOWED = 2 as const;
export const MAX_EMAILS = 25;
export const PAID_AT_SENTINEL = "serverTimestamp";

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,220}$/;
const AUTH_CODE_PATTERN = /^auth\/[a-z0-9-]{1,64}$/;

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class ResetRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResetRefused";
  }
}

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface InterviewUsageState {
  completedIds: string[];
  active: unknown;
}

export interface AccountSnapshot {
  entitlement: Record<string, unknown> | null;
  interviews: InterviewUsageState | null;
}

export interface EntitlementReset {
  paid: true;
  provider: "stripe";
  interviewsAllowed: 2;
  disputeStatus: null;
  disputeId: null;
  paidAt?: typeof PAID_AT_SENTINEL;
}

export interface UsageReset {
  interviews: {
    completedIds: [];
    active: null;
  };
}

export interface PlannedReset {
  entitlement: EntitlementReset;
  usage: UsageReset;
}

export interface ResetLogRecord {
  event: "reset-test-usage";
  dryRun: boolean;
  email: string;
  uid: string;
  before: {
    entitlement: unknown;
    interviews: unknown;
  };
  after: {
    entitlement: EntitlementReset;
    interviews: UsageReset["interviews"];
  };
  timestamp: string;
  runId: string;
  databaseId: string;
}

export interface ResetDoc {
  exists: boolean;
  data: Record<string, unknown>;
}

export interface ResetTx {
  get(path: string): Promise<ResetDoc>;
  set(path: string, data: Record<string, unknown>, options?: { merge: boolean }): void;
}

export interface CommitInput {
  email: string;
  uid: string;
  runId: string;
  now: Date;
  databaseId: string;
}

export interface ResetDeps {
  getUserByEmail(email: string): Promise<AuthUser>;
  readAccount(uid: string): Promise<AccountSnapshot>;
  commit(input: CommitInput): Promise<ResetLogRecord>;
  log(line: string): void;
}

export interface AdminSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface AdminDocRef {
  path: string;
  get(): Promise<AdminSnapshot>;
}

export interface AdminTx {
  get(ref: AdminDocRef): Promise<AdminSnapshot>;
  set(ref: AdminDocRef, data: Record<string, unknown>, options?: { merge: boolean }): void;
}

export interface AdminDb {
  collection(name: string): { doc(id: string): AdminDocRef };
  runTransaction<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T>;
}

type AllowedCollection = "entitlements" | "usage" | "admin_resets";

export function isTestAccountEmail(email: string): boolean {
  // JavaScript `$` also matches before a final newline. Reject CR/LF so a
  // second line cannot ride along with an allowlisted address.
  if (email.length === 0 || email.length > 254) return false;
  if (email !== email.trim() || /[\r\n\0]/.test(email)) return false;
  return TEST_ACCOUNT_EMAIL.test(email);
}

export function assertTestAccountEmail(email: string): void {
  if (!isTestAccountEmail(email)) {
    throw new ResetRefused(`refusing email that is not on the test-account allowlist: ${email}`);
  }
}

export function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) {
    throw new ResetRefused("refusing Firebase Auth uid with unexpected characters");
  }
}

export function parseEmailList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw new ResetRefused("emails list contains an empty entry");
  }
  if (parts.length > MAX_EMAILS) {
    throw new ResetRefused(`refusing more than ${MAX_EMAILS} emails`);
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const email of parts) {
    if (email.length > 254) {
      throw new ResetRefused("refusing an oversized email entry");
    }
    assertTestAccountEmail(email);
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

export function parseDryRun(value: string | boolean | undefined): boolean {
  if (value === undefined || value === "") return true;
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new ResetRefused("dry_run must be true or false");
}

export function assertTarget(env: NodeJS.ProcessEnv): { projectId: string; databaseId: string } {
  const projectId = (env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID).trim();
  const databaseId = (env.FIRESTORE_DATABASE_ID || DATABASE_ID).trim();
  if (projectId !== PROJECT_ID) {
    throw new ResetRefused(`refusing Google Cloud project ${projectId}`);
  }
  if (databaseId !== DATABASE_ID) {
    throw new ResetRefused(`refusing Firestore database ${databaseId}`);
  }
  return { projectId, databaseId };
}

export function resolveRunId(env: NodeJS.ProcessEnv, now: Date): string {
  const run = env.GITHUB_RUN_ID?.trim() ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT?.trim() ?? "";
  if (run !== "" || attempt !== "") {
    if (!/^[0-9]{1,20}$/.test(run)) throw new ResetRefused("refusing unexpected GITHUB_RUN_ID");
    if (attempt !== "" && !/^[0-9]{1,6}$/.test(attempt)) {
      throw new ResetRefused("refusing unexpected GITHUB_RUN_ATTEMPT");
    }
    return `${run}.${attempt || "1"}`;
  }
  if (!Number.isFinite(now.getTime())) throw new ResetRefused("invalid timestamp");
  return `local-${now.getTime()}`;
}

export function auditDocId(runId: string, uid: string): string {
  assertUid(uid);
  if (!RUN_ID_PATTERN.test(runId)) throw new ResetRefused("refusing unexpected run id");
  const id = `reset_${runId.replace(/\./g, "_")}_${uid}`;
  if (!DOC_ID_PATTERN.test(id)) throw new ResetRefused("refusing unexpected audit id");
  return id;
}

export function parseResetPath(
  pathValue: string,
  uid: string,
  auditId: string
): { collection: AllowedCollection; id: string } {
  const expected: Array<[AllowedCollection, string]> = [
    ["entitlements", uid],
    ["usage", uid],
    ["admin_resets", auditId],
  ];
  for (const [collection, id] of expected) {
    if (pathValue === `${collection}/${id}`) return { collection, id };
  }
  throw new ResetRefused("refusing unexpected document path");
}

export function assertAuthRecord(requestedEmail: string, user: AuthUser): { email: string; uid: string } {
  assertTestAccountEmail(requestedEmail);
  const email = user.email ?? "";
  if (!isTestAccountEmail(email)) {
    throw new ResetRefused(
      `refusing Firebase Auth user ${user.uid || "(no uid)"} whose email is not on the test-account allowlist: ${email || "(missing)"}`
    );
  }
  if (email.toLowerCase() !== requestedEmail.toLowerCase()) {
    throw new ResetRefused(
      `refusing Firebase Auth user ${user.uid || "(no uid)"} whose email does not match the requested address`
    );
  }
  assertUid(user.uid);
  return { email, uid: user.uid };
}

export function planReset(before: AccountSnapshot): PlannedReset {
  const entitlement: EntitlementReset = {
    paid: true,
    provider: "stripe",
    interviewsAllowed: FRESH_INTERVIEWS_ALLOWED,
    disputeStatus: null,
    disputeId: null,
  };
  if (before.entitlement == null || before.entitlement.paidAt == null) {
    entitlement.paidAt = PAID_AT_SENTINEL;
  }
  return {
    entitlement,
    usage: {
      interviews: {
        completedIds: [],
        active: null,
      },
    },
  };
}

export function toLogValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toLogValue(item));
  if (typeof value === "object") {
    const record = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof record.toDate === "function") {
      try {
        const date = record.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
      } catch {
        return null;
      }
    }
    const keys = Object.keys(record);
    const seconds = typeof record.seconds === "number" ? record.seconds : record._seconds;
    const timestampKeys = new Set(["seconds", "nanoseconds", "_seconds", "_nanoseconds"]);
    if (typeof seconds === "number" && keys.length > 0 && keys.every((key) => timestampKeys.has(key))) {
      const nanos = typeof record.nanoseconds === "number" ? record.nanoseconds : record._nanoseconds;
      const ms = seconds * 1000 + (typeof nanos === "number" && Number.isFinite(nanos) ? nanos / 1e6 : 0);
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      out[key] = toLogValue(item);
    }
    return out;
  }
  return null;
}

function readInterviews(value: unknown): InterviewUsageState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { completedIds: [], active: null };
  }
  const record = value as { completedIds?: unknown; active?: unknown };
  const completedIds = Array.isArray(record.completedIds)
    ? record.completedIds.filter((id): id is string => typeof id === "string")
    : [];
  return { completedIds, active: record.active ?? null };
}

export function snapshotFrom(entitlementDoc: ResetDoc, usageDoc: ResetDoc): AccountSnapshot {
  const interviews = usageDoc.exists && Object.prototype.hasOwnProperty.call(usageDoc.data, "interviews")
    ? readInterviews(usageDoc.data.interviews)
    : null;
  return {
    entitlement: entitlementDoc.exists ? entitlementDoc.data : null,
    interviews,
  };
}

export function buildLogRecord(input: {
  dryRun: boolean;
  email: string;
  uid: string;
  before: AccountSnapshot;
  plan: PlannedReset;
  now: Date;
  runId: string;
  databaseId: string;
}): ResetLogRecord {
  return {
    event: "reset-test-usage",
    dryRun: input.dryRun,
    email: input.email,
    uid: input.uid,
    before: {
      entitlement: toLogValue(input.before.entitlement),
      interviews: toLogValue(input.before.interviews),
    },
    after: {
      entitlement: input.plan.entitlement,
      interviews: input.plan.usage.interviews,
    },
    timestamp: input.now.toISOString(),
    runId: input.runId,
    databaseId: input.databaseId,
  };
}

export async function commitAccountReset(tx: ResetTx, input: CommitInput): Promise<ResetLogRecord> {
  const account = assertAuthRecord(input.email, { uid: input.uid, email: input.email });
  const auditId = auditDocId(input.runId, account.uid);
  const entPath = `entitlements/${account.uid}`;
  const usePath = `usage/${account.uid}`;
  const auditPath = `admin_resets/${auditId}`;
  parseResetPath(entPath, account.uid, auditId);
  parseResetPath(usePath, account.uid, auditId);
  parseResetPath(auditPath, account.uid, auditId);
  const entitlementDoc = await tx.get(entPath);
  const usageDoc = await tx.get(usePath);
  const before = snapshotFrom(entitlementDoc, usageDoc);
  const plan = planReset(before);
  const record = buildLogRecord({
    dryRun: false,
    email: account.email,
    uid: account.uid,
    before,
    plan,
    now: input.now,
    runId: input.runId,
    databaseId: input.databaseId,
  });
  tx.set(entPath, { ...plan.entitlement }, { merge: true });
  tx.set(usePath, { ...plan.usage }, { merge: true });
  tx.set(auditPath, {
    schemaVersion: 1,
    email: record.email,
    uid: record.uid,
    before: record.before,
    after: record.after,
    timestamp: record.timestamp,
    runId: record.runId,
    databaseId: record.databaseId,
    dryRun: false,
  });
  return record;
}

export function createAllowlistedAuth(
  auth: { getUserByEmail(email: string): Promise<AuthUser> }
): ResetDeps["getUserByEmail"] {
  return async (email: string) => {
    assertTestAccountEmail(email);
    try {
      return await auth.getUserByEmail(email);
    } catch (error) {
      if (error instanceof ResetRefused) throw error;
      throw mapAuthError(email, error);
    }
  };
}

function mapAuthError(email: string, error: unknown): ResetRefused {
  const raw = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const code = AUTH_CODE_PATTERN.test(raw) ? raw : "unknown";
  if (code === "auth/user-not-found") {
    return new ResetRefused(`no Firebase Auth user for ${email}`);
  }
  return new ResetRefused(`Firebase Auth lookup failed for ${email} (${code})`);
}

export function createFirestoreStore(
  db: AdminDb,
  serverTimestamp: () => unknown
): Pick<ResetDeps, "readAccount" | "commit"> {
  const refFor = (collection: AllowedCollection, id: string): AdminDocRef => {
    if (collection !== "entitlements" && collection !== "usage" && collection !== "admin_resets") {
      throw new ResetRefused("refusing unexpected collection");
    }
    if (!DOC_ID_PATTERN.test(id)) throw new ResetRefused("refusing unexpected document id");
    return db.collection(collection).doc(id);
  };
  const wrap = (snap: AdminSnapshot): ResetDoc => ({
    exists: snap.exists,
    data: snap.exists ? (snap.data() ?? {}) : {},
  });
  return {
    async readAccount(uid: string) {
      assertUid(uid);
      const entitlementDoc = wrap(await refFor("entitlements", uid).get());
      const usageDoc = wrap(await refFor("usage", uid).get());
      return snapshotFrom(entitlementDoc, usageDoc);
    },
    async commit(input: CommitInput) {
      const account = assertAuthRecord(input.email, { uid: input.uid, email: input.email });
      const auditId = auditDocId(input.runId, account.uid);
      return db.runTransaction(async (adminTx) => {
        const tx: ResetTx = {
          async get(pathValue: string) {
            const parsed = parseResetPath(pathValue, account.uid, auditId);
            return wrap(await adminTx.get(refFor(parsed.collection, parsed.id)));
          },
          set(pathValue: string, data: Record<string, unknown>, options?: { merge: boolean }) {
            const parsed = parseResetPath(pathValue, account.uid, auditId);
            let payload = data;
            if (parsed.collection === "entitlements" && data.paidAt === PAID_AT_SENTINEL) {
              payload = { ...data, paidAt: serverTimestamp() };
            }
            if (options?.merge) {
              adminTx.set(refFor(parsed.collection, parsed.id), payload, { merge: true });
            } else {
              adminTx.set(refFor(parsed.collection, parsed.id), payload);
            }
          },
        };
        return commitAccountReset(tx, { ...input, email: account.email, uid: account.uid });
      });
    },
  };
}

export async function resetTestAccounts(options: {
  emailsRaw: string | undefined;
  dryRun: boolean;
  runId: string;
  now: Date;
  databaseId: string;
  deps: ResetDeps;
}): Promise<ResetLogRecord[]> {
  if (options.databaseId !== DATABASE_ID) {
    throw new ResetRefused(`refusing Firestore database ${options.databaseId}`);
  }
  const emails = parseEmailList(options.emailsRaw);
  if (emails.length === 0) {
    options.deps.log(JSON.stringify({
      event: "reset-test-usage",
      dryRun: options.dryRun,
      runId: options.runId,
      timestamp: options.now.toISOString(),
      databaseId: options.databaseId,
      accounts: 0,
      wrote: false,
      message: "no emails provided; wrote nothing",
    }));
    return [];
  }
  const resolved: Array<{ email: string; uid: string }> = [];
  for (const email of emails) {
    assertTestAccountEmail(email);
    const user = await options.deps.getUserByEmail(email);
    resolved.push(assertAuthRecord(email, user));
  }
  const records: ResetLogRecord[] = [];
  for (const account of resolved) {
    assertTestAccountEmail(account.email);
    assertUid(account.uid);
    if (options.dryRun) {
      const before = await options.deps.readAccount(account.uid);
      const plan = planReset(before);
      const record = buildLogRecord({
        dryRun: true,
        email: account.email,
        uid: account.uid,
        before,
        plan,
        now: options.now,
        runId: options.runId,
        databaseId: options.databaseId,
      });
      options.deps.log(JSON.stringify(record));
      records.push(record);
      continue;
    }
    const record = await options.deps.commit({
      email: account.email,
      uid: account.uid,
      runId: options.runId,
      now: options.now,
      databaseId: options.databaseId,
    });
    if (record.dryRun || record.uid !== account.uid || record.email.toLowerCase() !== account.email.toLowerCase()) {
      throw new ResetRefused("refusing a commit result that does not match the allowlisted account");
    }
    options.deps.log(JSON.stringify(record));
    records.push(record);
  }
  options.deps.log(JSON.stringify({
    event: "reset-test-usage",
    dryRun: options.dryRun,
    runId: options.runId,
    timestamp: options.now.toISOString(),
    databaseId: options.databaseId,
    accounts: records.length,
    wrote: !options.dryRun,
  }));
  return records;
}

interface ArgFlags {
  dryRun?: string;
  emails?: string;
}

function parseArgv(argv: string[]): ArgFlags {
  const flags: ArgFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new ResetRefused("dry_run must be true or false");
      flags.dryRun = value;
      index += 1;
    } else if (arg.startsWith("--dry-run=")) {
      flags.dryRun = arg.slice("--dry-run=".length);
    } else if (arg === "--emails") {
      const value = argv[index + 1];
      if (value === undefined) throw new ResetRefused("emails flag is missing a value");
      flags.emails = value;
      index += 1;
    } else if (arg.startsWith("--emails=")) {
      flags.emails = arg.slice("--emails=".length);
    } else {
      throw new ResetRefused("unknown argument");
    }
  }
  return flags;
}

export function loadResetOptions(argv: string[], env: NodeJS.ProcessEnv, now: Date): {
  dryRun: boolean;
  emailsRaw: string;
  runId: string;
  projectId: string;
  databaseId: string;
} {
  const flags = parseArgv(argv);
  const target = assertTarget(env);
  return {
    dryRun: parseDryRun(flags.dryRun ?? env.RESET_DRY_RUN),
    emailsRaw: flags.emails ?? env.RESET_EMAILS ?? "",
    runId: resolveRunId(env, now),
    projectId: target.projectId,
    databaseId: target.databaseId,
  };
}

function safeErrorMessage(_error: unknown): string {
  return "reset failed";
}

function openFirebase(projectId: string, databaseId: string): {
  getUserByEmail: ResetDeps["getUserByEmail"];
  store: Pick<ResetDeps, "readAccount" | "commit">;
} {
  if (projectId !== PROJECT_ID || databaseId !== DATABASE_ID) {
    throw new ResetRefused("refusing to open Firebase for a different project or database");
  }
  const require = createRequire(path.join(HERE, "../functions/package.json"));
  const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app") as {
    initializeApp: (options?: { credential?: unknown; projectId?: string }) => unknown;
    applicationDefault: () => unknown;
    getApps: () => unknown[];
  };
  const { getFirestore, FieldValue } = require("firebase-admin/firestore") as {
    getFirestore: (app: unknown, databaseId: string) => AdminDb;
    FieldValue: { serverTimestamp: () => unknown };
  };
  const { getAuth } = require("firebase-admin/auth") as {
    getAuth: (app?: unknown) => { getUserByEmail(email: string): Promise<{ uid: string; email?: string }> };
  };
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }
  const app = getApps()[0];
  const db = getFirestore(app, databaseId);
  const auth = getAuth(app);
  return {
    getUserByEmail: createAllowlistedAuth({
      async getUserByEmail(email: string) {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, email: user.email ?? null };
      },
    }),
    store: createFirestoreStore(db, () => FieldValue.serverTimestamp()),
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const options = loadResetOptions(process.argv.slice(2), process.env, now);
  const firebase = openFirebase(options.projectId, options.databaseId);
  await resetTestAccounts({
    emailsRaw: options.emailsRaw,
    dryRun: options.dryRun,
    runId: options.runId,
    now,
    databaseId: options.databaseId,
    deps: {
      getUserByEmail: firebase.getUserByEmail,
      readAccount: firebase.store.readAccount,
      commit: firebase.store.commit,
      log: (line) => {
        console.log(line);
      },
    },
  });
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (/(^|\/)reset-test-usage\.(ts|js|mjs)$/.test(entry)) {
  main().catch((error: unknown) => {
    if (error instanceof ResetRefused) {
      console.error(error.message);
    } else {
      console.error(safeErrorMessage(error));
    }
    process.exit(1);
  });
}
