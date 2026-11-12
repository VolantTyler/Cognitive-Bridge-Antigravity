/**
 * Per-interview token totals and estimated USD from usage_server.
 * Groups by reservationId when the row has one, otherwise by sessionId.
 * Mirror chat, default chat, and judge rows are all included.
 *
 * Auth is Application Default Credentials (gcloud auth application-default login
 * or a GOOGLE_APPLICATION_CREDENTIALS file outside the repo). This script never
 * reads a provider API key and never writes a key checked into the repository.
 *
 *   npx tsx scripts/cost-report.ts
 *   npx tsx scripts/cost-report.ts --since 2026-01-01 --until 2026-01-31 --reservation-ids iv_a,iv_b
 *
 * GitHub Actions sets COST_REPORT_SINCE, COST_REPORT_UNTIL, and
 * COST_REPORT_RESERVATION_IDS. When GITHUB_STEP_SUMMARY is set, the same
 * report is appended there as markdown.
 *
 * Read-only: the Firestore path selects usage fields and calls get().
 * It does not write.
 *
 * Prices live in functions/src/pricing.ts (placeholders). Verify them before a go/no-go.
 * jev-latest is priced at $0 there, so judge rows add $0 until that card changes.
 *
 * Printed output has no message content, no emails, and no secrets.
 * Account ids are 12-character sha256 prefixes.
 */

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRICING, costUsdForUsage, type PricingTable } from "../functions/src/pricing";

export const DEFAULT_COST_MODEL = "gemini-2.5-flash";
export const PRO_PREVIEW_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_FIREBASE_PROJECT_ID = "cognitive-bridge-ai";
export const UID_HASH_HEX = 12;

export const USAGE_READ_FIELDS = [
  "uid",
  "sessionId",
  "reservationId",
  "feature",
  "model",
  "promptTokens",
  "completionTokens",
  "ts",
] as const;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_LABEL = /^[A-Za-z0-9._-]{1,80}$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+)?)?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface UsageRow {
  reservationId?: string | null;
  sessionId?: string | null;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  feature?: string;
  uid?: string | null;
  ts?: unknown;
}

export interface InterviewTotal {
  id: string;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  calls: number;
  usdByFeature: Record<string, number>;
  callsByFeature: Record<string, number>;
  callsByModel: Record<string, number>;
  nonDefaultModelCalls: number;
  proPreviewCalls: number;
  uidHashes: string[];
  firstTs: string | null;
  lastTs: string | null;
}

export interface SessionCostSummary {
  interviewCount: number;
  skippedWithoutSession: number;
  medianTokens: number;
  p90Tokens: number;
  medianUsd: number;
  p90Usd: number;
  nonDefaultModelCalls: number;
  proPreviewCalls: number;
  interviews: InterviewTotal[];
}

export interface CostReportFilters {
  since: Date | null;
  until: Date | null;
  reservationIds: string[] | null;
}

export interface UsageDoc {
  data: () => Record<string, unknown>;
}

export interface UsageQuery {
  select: (...fields: string[]) => UsageQuery;
  get: () => Promise<{ docs: UsageDoc[] }>;
}

export interface UsageDb {
  collection: (name: string) => UsageQuery;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadPricing(): PricingTable {
  return PRICING;
}

export function costForRow(row: UsageRow, table: PricingTable = PRICING): number {
  return costUsdForUsage(row, table);
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] * (high - rank) + sorted[high] * (rank - low);
}

export function shortUidHash(uid: string): string {
  return createHash("sha256").update(uid, "utf8").digest("hex").slice(0, UID_HASH_HEX);
}

export function canonicalModel(model: string): string {
  return model.trim().replace(/^models\//, "");
}

export function isNonDefaultModel(model: string): boolean {
  return canonicalModel(model) !== DEFAULT_COST_MODEL;
}

export function isProPreviewModel(model: string): boolean {
  return canonicalModel(model).includes(PRO_PREVIEW_MODEL);
}

export function interviewKey(row: UsageRow): string | null {
  const reservationId = presentId(row.reservationId);
  if (reservationId) return reservationId;
  return presentId(row.sessionId);
}

export function rowTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === "object") {
    const stamp = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof stamp.toDate === "function") {
      try {
        const parsed = stamp.toDate();
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
      } catch {
        return null;
      }
    }
    const seconds = typeof stamp.seconds === "number" ? stamp.seconds : stamp._seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      const nanos = typeof stamp.nanoseconds === "number"
        ? stamp.nanoseconds
        : (typeof stamp._nanoseconds === "number" ? stamp._nanoseconds : 0);
      const parsed = new Date(seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
}

export function parseBound(input: string, edge: "since" | "until"): Date {
  const trimmed = input.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = edge === "since"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      throw new Error(`Invalid ${edge} value. Use an ISO timestamp or YYYY-MM-DD.`);
    }
    return date;
  }
  if (!ISO_INSTANT.test(trimmed)) {
    throw new Error(`Invalid ${edge} value. Use an ISO timestamp or YYYY-MM-DD.`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${edge} value. Use an ISO timestamp or YYYY-MM-DD.`);
  }
  return parsed;
}

export function parseReservationIds(input: string | null | undefined): string[] | null {
  if (typeof input !== "string" || input.trim().length === 0) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (!SAFE_ID.test(id)) {
      throw new Error("Invalid reservation id. Use comma-separated ids made of letters, numbers, underscores, and hyphens.");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

export function parseCostReportFilters(argv: readonly string[], env: NodeJS.ProcessEnv = {}): CostReportFilters {
  let sinceRaw = env.COST_REPORT_SINCE ?? "";
  let untilRaw = env.COST_REPORT_UNTIL ?? "";
  let reservationRaw = env.COST_REPORT_RESERVATION_IDS ?? "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const next = argv[i + 1];
    if (arg === "--since" || arg === "--until" || arg === "--reservation-ids") {
      if (next === undefined) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--since") sinceRaw = next;
      else if (arg === "--until") untilRaw = next;
      else reservationRaw = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--since=")) {
      sinceRaw = arg.slice("--since=".length);
      continue;
    }
    if (arg.startsWith("--until=")) {
      untilRaw = arg.slice("--until=".length);
      continue;
    }
    if (arg.startsWith("--reservation-ids=")) {
      reservationRaw = arg.slice("--reservation-ids=".length);
      continue;
    }
    throw new Error("Unknown argument.");
  }
  const since = sinceRaw.trim() ? parseBound(sinceRaw, "since") : null;
  const until = untilRaw.trim() ? parseBound(untilRaw, "until") : null;
  if (since && until && since.getTime() > until.getTime()) {
    throw new Error("since is after until");
  }
  return {
    since,
    until,
    reservationIds: parseReservationIds(reservationRaw),
  };
}

export function filterUsageRows(rows: UsageRow[], filters: CostReportFilters): UsageRow[] {
  const allowed = filters.reservationIds && filters.reservationIds.length > 0
    ? new Set(filters.reservationIds)
    : null;
  const sinceMs = filters.since ? filters.since.getTime() : null;
  const untilMs = filters.until ? filters.until.getTime() : null;
  const bounded = sinceMs !== null || untilMs !== null;
  return rows.filter((row) => {
    if (allowed) {
      const reservationId = presentId(row.reservationId);
      if (!reservationId || !allowed.has(reservationId)) return false;
    }
    if (!bounded) return true;
    const ts = rowTimestamp(row.ts);
    if (!ts) return false;
    const ms = ts.getTime();
    if (sinceMs !== null && ms < sinceMs) return false;
    if (untilMs !== null && ms > untilMs) return false;
    return true;
  });
}

export function projectUsageRow(data: Record<string, unknown>): UsageRow {
  const row: UsageRow = {};
  if ("reservationId" in data && (typeof data.reservationId === "string" || data.reservationId == null)) {
    row.reservationId = data.reservationId as string | null;
  }
  if ("sessionId" in data && (typeof data.sessionId === "string" || data.sessionId == null)) {
    row.sessionId = data.sessionId as string | null;
  }
  if ("uid" in data && (typeof data.uid === "string" || data.uid == null)) {
    row.uid = data.uid as string | null;
  }
  if (typeof data.feature === "string") row.feature = data.feature;
  if (typeof data.model === "string") row.model = data.model;
  if (typeof data.promptTokens === "number") row.promptTokens = data.promptTokens;
  if (typeof data.completionTokens === "number") row.completionTokens = data.completionTokens;
  if ("ts" in data) row.ts = data.ts;
  return row;
}

export async function readUsageRows(db: UsageDb): Promise<UsageRow[]> {
  const snap = await db.collection("usage_server").select(...USAGE_READ_FIELDS).get();
  return snap.docs.map((doc) => projectUsageRow(doc.data()));
}

export function summarizeSessions(rows: UsageRow[], table: PricingTable): SessionCostSummary {
  const byInterview = new Map<string, InterviewTotal>();
  let skippedWithoutSession = 0;
  for (const row of rows) {
    const key = interviewKey(row);
    if (!key) {
      skippedWithoutSession += 1;
      continue;
    }
    const bucket = byInterview.get(key) ?? emptyInterview(key);
    const promptTokens = finite(row.promptTokens);
    const completionTokens = finite(row.completionTokens);
    const usd = costForRow(row, table);
    const feature = featureKey(presentId(row.feature) ?? "unknown");
    const model = modelKey(presentId(row.model) ?? "unknown");
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.tokens += promptTokens + completionTokens;
    bucket.usd += usd;
    bucket.calls += 1;
    bucket.usdByFeature[feature] = (bucket.usdByFeature[feature] ?? 0) + usd;
    bucket.callsByFeature[feature] = (bucket.callsByFeature[feature] ?? 0) + 1;
    bucket.callsByModel[model.label] = (bucket.callsByModel[model.label] ?? 0) + 1;
    if (model.nonDefault) bucket.nonDefaultModelCalls += 1;
    if (model.proPreview) bucket.proPreviewCalls += 1;
    const uid = presentId(row.uid);
    if (uid) {
      const hash = shortUidHash(uid);
      if (!bucket.uidHashes.includes(hash)) bucket.uidHashes.push(hash);
    }
    const ts = rowTimestamp(row.ts);
    if (ts) {
      const iso = ts.toISOString();
      if (!bucket.firstTs || iso < bucket.firstTs) bucket.firstTs = iso;
      if (!bucket.lastTs || iso > bucket.lastTs) bucket.lastTs = iso;
    }
    byInterview.set(key, bucket);
  }
  const interviews = [...byInterview.values()]
    .map((item) => ({ ...item, uidHashes: [...item.uidHashes].sort() }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tokens = interviews.map((item) => item.tokens).sort((a, b) => a - b);
  const usd = interviews.map((item) => item.usd).sort((a, b) => a - b);
  return {
    interviewCount: interviews.length,
    skippedWithoutSession,
    medianTokens: percentile(tokens, 0.5),
    p90Tokens: percentile(tokens, 0.9),
    medianUsd: percentile(usd, 0.5),
    p90Usd: percentile(usd, 0.9),
    nonDefaultModelCalls: interviews.reduce((sum, item) => sum + item.nonDefaultModelCalls, 0),
    proPreviewCalls: interviews.reduce((sum, item) => sum + item.proPreviewCalls, 0),
    interviews,
  };
}

export function buildReport(
  rows: UsageRow[],
  filters: CostReportFilters,
  table: PricingTable = PRICING
): SessionCostSummary {
  return summarizeSessions(filterUsageRows(rows, filters), table);
}

export function describeFilters(filters?: CostReportFilters): string {
  if (!filters || (!filters.since && !filters.until && !(filters.reservationIds && filters.reservationIds.length > 0))) {
    return "Filters: none";
  }
  const parts: string[] = [];
  if (filters.since) parts.push(`since=${filters.since.toISOString()}`);
  if (filters.until) parts.push(`until=${filters.until.toISOString()}`);
  if (filters.reservationIds && filters.reservationIds.length > 0) {
    parts.push(`reservationIds=${filters.reservationIds.join(",")}`);
  }
  return `Filters: ${parts.join(" ")}`;
}

export function formatSummary(
  summary: SessionCostSummary,
  table: PricingTable = PRICING,
  filters?: CostReportFilters
): string {
  const lines = [
    ...headerLines(summary, table, filters),
    "Per-interview totals:",
    ...summary.interviews.map((item) => interviewLine(item)),
    ...overallLines(summary),
  ];
  return redactEmails(lines.join("\n"));
}

export function formatSummaryMarkdown(
  summary: SessionCostSummary,
  table: PricingTable = PRICING,
  filters?: CostReportFilters
): string {
  const header = [
    "# Interview cost report",
    "",
    ...headerLines(summary, table, filters),
    "",
    "| Interview | UID hash | First ts | Last ts | Calls | Features | Models | Flags | Prompt tokens | Completion tokens | Tokens | Estimated USD | USD by feature |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = summary.interviews.map((item) => {
    const cells = [
      displayId(item.id),
      item.uidHashes.join(",") || "-",
      item.firstTs ?? "-",
      item.lastTs ?? "-",
      String(item.calls),
      paired(item.callsByFeature, "count"),
      formatModels(item),
      formatFlags(item),
      tokenText(item.promptTokens),
      tokenText(item.completionTokens),
      item.tokens.toFixed(1),
      money(item.usd),
      paired(item.usdByFeature, "usd"),
    ].map(mdCell);
    return `| ${cells.join(" | ")} |`;
  });
  const lines = [...header, ...rows, "", ...overallLines(summary), ""];
  return redactEmails(lines.join("\n"));
}

export function redactEmails(text: string): string {
  return text.replace(EMAIL, "[redacted-email]");
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "cost report failed";
  if (/private_key|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY|credentials_json/i.test(message)) {
    return "cost report failed during authentication";
  }
  return redactEmails(message).slice(0, 500);
}

export function writeGitHubStepSummary(markdown: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (typeof file !== "string" || file.trim().length === 0) return;
  const body = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  appendFileSync(file, body, "utf8");
}

export function firebaseProjectId(env: NodeJS.ProcessEnv = process.env): string {
  return presentId(env.GOOGLE_CLOUD_PROJECT) ?? presentId(env.GCLOUD_PROJECT) ?? DEFAULT_FIREBASE_PROJECT_ID;
}

function emptyInterview(id: string): InterviewTotal {
  return {
    id,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    usd: 0,
    calls: 0,
    usdByFeature: {},
    callsByFeature: {},
    callsByModel: {},
    nonDefaultModelCalls: 0,
    proPreviewCalls: 0,
    uidHashes: [],
    firstTs: null,
    lastTs: null,
  };
}

function featureKey(feature: string): string {
  return SAFE_LABEL.test(feature) ? feature : `feature_${shortUidHash(feature)}`;
}

function modelKey(model: string): { label: string; nonDefault: boolean; proPreview: boolean } {
  const canonical = canonicalModel(model);
  const proPreview = isProPreviewModel(canonical);
  const nonDefault = isNonDefaultModel(canonical);
  const label = proPreview
    ? PRO_PREVIEW_MODEL
    : (SAFE_LABEL.test(canonical) ? canonical : `model_${shortUidHash(canonical)}`);
  return { label, nonDefault, proPreview };
}

function displayId(id: string): string {
  return SAFE_ID.test(id) ? id : `id_${shortUidHash(id)}`;
}

function money(value: number): string {
  return value.toFixed(6);
}

function tokenText(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function paired(record: Record<string, number>, kind: "count" | "usd"): string {
  const keys = Object.keys(record).sort();
  if (keys.length === 0) return "-";
  return keys.map((key) => `${key}=${kind === "usd" ? money(record[key] ?? 0) : tokenText(record[key] ?? 0)}`).join(",");
}

function formatModels(item: InterviewTotal): string {
  const keys = Object.keys(item.callsByModel).sort();
  if (keys.length === 0) return "-";
  return keys.map((model) => {
    const count = tokenText(item.callsByModel[model] ?? 0);
    if (isProPreviewModel(model)) return `${model}=${count}[FLAG gemini-3.1-pro-preview]`;
    if (isNonDefaultModel(model)) return `${model}=${count}[FLAG non-default-model]`;
    return `${model}=${count}`;
  }).join(",");
}

function formatFlags(item: InterviewTotal): string {
  const flags: string[] = [];
  if (item.nonDefaultModelCalls > 0) flags.push("non-default-model");
  if (item.proPreviewCalls > 0) flags.push("gemini-3.1-pro-preview");
  return flags.length > 0 ? flags.join(",") : "-";
}

function interviewLine(item: InterviewTotal): string {
  return [
    `  ${displayId(item.id)}`,
    `uid=${item.uidHashes.length > 0 ? item.uidHashes.join(",") : "-"}`,
    `first=${item.firstTs ?? "-"}`,
    `last=${item.lastTs ?? "-"}`,
    `calls=${item.calls}`,
    `features=${paired(item.callsByFeature, "count")}`,
    `models=${formatModels(item)}`,
    `flags=${formatFlags(item)}`,
    `promptTokens=${tokenText(item.promptTokens)}`,
    `completionTokens=${tokenText(item.completionTokens)}`,
    `tokens=${item.tokens.toFixed(1)}`,
    `usd=${money(item.usd)}`,
    `usdByFeature=${paired(item.usdByFeature, "usd")}`,
  ].join("  ");
}

function headerLines(summary: SessionCostSummary, table: PricingTable, filters?: CostReportFilters): string[] {
  return [
    table.placeholder !== false
      ? "Prices are PLACEHOLDERS. Verify functions/src/pricing.ts before any go/no-go."
      : "Prices loaded from functions/src/pricing.ts.",
    jevPriceIsZero(table)
      ? "Jev judge rows record $0. functions/src/pricing.ts prices jev-latest at $0 per call."
      : "Jev judge rows use the jev-latest card in functions/src/pricing.ts.",
    "UID values are 12-character sha256 prefixes, not account ids or emails.",
    `Interviews: ${summary.interviewCount}`,
    `Rows skipped (no reservationId or sessionId): ${summary.skippedWithoutSession}`,
    describeFilters(filters),
  ];
}

function overallLines(summary: SessionCostSummary): string[] {
  return [
    "Overall:",
    `Median tokens per interview: ${summary.medianTokens.toFixed(1)}`,
    `P90 tokens per interview: ${summary.p90Tokens.toFixed(1)}`,
    `Median estimated USD per interview: ${money(summary.medianUsd)}`,
    `P90 estimated USD per interview: ${money(summary.p90Usd)}`,
    `Non-default model calls: ${summary.nonDefaultModelCalls}`,
    `gemini-3.1-pro-preview calls: ${summary.proPreviewCalls}`,
  ];
}

function jevPriceIsZero(table: PricingTable): boolean {
  const row = table.models["jev-latest"];
  if (!row) return false;
  return row.inputPerMillionUsd === 0 && row.outputPerMillionUsd === 0 && (row.perCallUsd ?? 0) === 0;
}

function presentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function openFirestore(): UsageDb {
  const require = createRequire(path.join(HERE, "../functions/package.json"));
  const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app") as {
    initializeApp: (options?: { credential?: unknown; projectId?: string }) => unknown;
    applicationDefault: () => unknown;
    getApps: () => unknown[];
  };
  const { getFirestore } = require("firebase-admin/firestore") as {
    getFirestore: (app?: unknown, databaseId?: string) => UsageDb;
  };
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: firebaseProjectId(),
    });
  }
  const databaseId = process.env.FIRESTORE_DATABASE_ID
    || "ai-studio-10d489d8-3b32-488a-9698-e415f2608028";
  return getFirestore(getApps()[0], databaseId);
}

async function main(): Promise<void> {
  const pricing = loadPricing();
  const filters = parseCostReportFilters(process.argv.slice(2), process.env);
  const rows = await readUsageRows(openFirestore());
  const summary = buildReport(rows, filters, pricing);
  const text = formatSummary(summary, pricing, filters);
  const markdown = formatSummaryMarkdown(summary, pricing, filters);
  console.log(text);
  writeGitHubStepSummary(markdown);
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (/(^|\/)cost-report\.(ts|js|mjs)$/.test(entry)) {
  main().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    process.exit(1);
  });
}
