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
 *
 * Prices live in functions/src/pricing.ts (placeholders). Verify them before a go/no-go.
 * jev-latest is priced at $0 there, so judge rows add $0 until that card changes.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRICING, costUsdForUsage, type PricingTable } from "../functions/src/pricing";

export interface UsageRow {
  reservationId?: string | null;
  sessionId?: string | null;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  feature?: string;
}

export interface InterviewTotal {
  id: string;
  tokens: number;
  usd: number;
  calls: number;
  usdByFeature: Record<string, number>;
}

export interface SessionCostSummary {
  interviewCount: number;
  skippedWithoutSession: number;
  medianTokens: number;
  p90Tokens: number;
  medianUsd: number;
  p90Usd: number;
  interviews: InterviewTotal[];
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

export function interviewKey(row: UsageRow): string | null {
  const reservationId = presentId(row.reservationId);
  if (reservationId) return reservationId;
  return presentId(row.sessionId);
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
    const bucket = byInterview.get(key) ?? { id: key, tokens: 0, usd: 0, calls: 0, usdByFeature: {} };
    const tokens = finite(row.promptTokens) + finite(row.completionTokens);
    const usd = costForRow(row, table);
    const feature = presentId(row.feature) ?? "unknown";
    bucket.tokens += tokens;
    bucket.usd += usd;
    bucket.calls += 1;
    bucket.usdByFeature[feature] = (bucket.usdByFeature[feature] ?? 0) + usd;
    byInterview.set(key, bucket);
  }
  const interviews = [...byInterview.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tokens = interviews.map((item) => item.tokens).sort((a, b) => a - b);
  const usd = interviews.map((item) => item.usd).sort((a, b) => a - b);
  return {
    interviewCount: interviews.length,
    skippedWithoutSession,
    medianTokens: percentile(tokens, 0.5),
    p90Tokens: percentile(tokens, 0.9),
    medianUsd: percentile(usd, 0.5),
    p90Usd: percentile(usd, 0.9),
    interviews,
  };
}

function jevPriceIsZero(table: PricingTable): boolean {
  const row = table.models["jev-latest"];
  if (!row) return false;
  return row.inputPerMillionUsd === 0 && row.outputPerMillionUsd === 0 && (row.perCallUsd ?? 0) === 0;
}

export function formatSummary(summary: SessionCostSummary, table: PricingTable = PRICING): string {
  const money = (value: number) => value.toFixed(6);
  const lines = [
    table.placeholder !== false
      ? "Prices are PLACEHOLDERS. Verify functions/src/pricing.ts before any go/no-go."
      : "Prices loaded from functions/src/pricing.ts.",
    jevPriceIsZero(table)
      ? "Jev judge rows record $0. functions/src/pricing.ts prices jev-latest at $0 per call."
      : "Jev judge rows use the jev-latest card in functions/src/pricing.ts.",
    `Interviews: ${summary.interviewCount}`,
    `Rows skipped (no reservationId or sessionId): ${summary.skippedWithoutSession}`,
    `Median tokens per interview: ${summary.medianTokens.toFixed(1)}`,
    `P90 tokens per interview: ${summary.p90Tokens.toFixed(1)}`,
    `Median estimated USD per interview: ${money(summary.medianUsd)}`,
    `P90 estimated USD per interview: ${money(summary.p90Usd)}`,
    "Per-interview totals:",
    ...summary.interviews.map((item) => {
      const features = Object.keys(item.usdByFeature).sort()
        .map((feature) => `${feature}=${money(item.usdByFeature[feature])}`)
        .join(",");
      return `  ${item.id}  calls=${item.calls}  tokens=${item.tokens.toFixed(1)}  usd=${money(item.usd)}  ${features}`;
    }),
  ];
  return lines.join("\n");
}

function presentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

async function main(): Promise<void> {
  const pricing = loadPricing();
  const require = createRequire(path.join(HERE, "../functions/package.json"));
  const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app") as {
    initializeApp: (options?: { credential?: unknown }) => unknown;
    applicationDefault: () => unknown;
    getApps: () => unknown[];
  };
  const { getFirestore } = require("firebase-admin/firestore") as {
    getFirestore: (app?: unknown, databaseId?: string) => {
      collection: (name: string) => { get: () => Promise<{ docs: Array<{ data: () => UsageRow }> }> };
    };
  };
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
  const databaseId = process.env.FIRESTORE_DATABASE_ID
    || "ai-studio-10d489d8-3b32-488a-9698-e415f2608028";
  const db = getFirestore(getApps()[0], databaseId);
  const snap = await db.collection("usage_server").get();
  const rows = snap.docs.map((doc) => doc.data());
  const summary = summarizeSessions(rows, pricing);
  console.log(formatSummary(summary, pricing));
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (/(^|\/)cost-report\.(ts|js|mjs)$/.test(entry)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "cost report failed";
    console.error(message);
    process.exit(1);
  });
}
