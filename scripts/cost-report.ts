/**
 * Median and p90 token totals and estimated USD per session from usage_server.
 *
 * Auth is Application Default Credentials (gcloud auth application-default login
 * or a GOOGLE_APPLICATION_CREDENTIALS file outside the repo). This script never
 * reads or writes a key checked into the repository.
 *
 *   npx tsx scripts/cost-report.ts
 *
 * Prices in scripts/pricing.json are placeholders. Verify them before a go/no-go.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PriceRow {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  perCallUsd?: number;
}

export interface PricingTable {
  placeholder?: boolean;
  comment?: string;
  models: Record<string, PriceRow>;
  default: PriceRow;
}

export interface UsageRow {
  sessionId?: string | null;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  feature?: string;
}

export interface SessionCostSummary {
  sessionCount: number;
  skippedWithoutSession: number;
  medianTokens: number;
  p90Tokens: number;
  medianUsd: number;
  p90Usd: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadPricing(filePath = path.join(HERE, "pricing.json")): PricingTable {
  return JSON.parse(readFileSync(filePath, "utf8")) as PricingTable;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] * (high - rank) + sorted[high] * (rank - low);
}

export function costForRow(row: UsageRow, table: PricingTable): number {
  const price = (row.model && table.models[row.model]) || table.default;
  const prompt = finite(row.promptTokens);
  const completion = finite(row.completionTokens);
  return (prompt / 1_000_000) * price.inputPerMillionUsd
    + (completion / 1_000_000) * price.outputPerMillionUsd
    + (price.perCallUsd ?? 0);
}

export function summarizeSessions(rows: UsageRow[], table: PricingTable): SessionCostSummary {
  const bySession = new Map<string, { tokens: number; usd: number }>();
  let skippedWithoutSession = 0;
  for (const row of rows) {
    if (!row.sessionId) {
      skippedWithoutSession += 1;
      continue;
    }
    const bucket = bySession.get(row.sessionId) ?? { tokens: 0, usd: 0 };
    bucket.tokens += finite(row.promptTokens) + finite(row.completionTokens);
    bucket.usd += costForRow(row, table);
    bySession.set(row.sessionId, bucket);
  }
  const totals = [...bySession.values()];
  const tokens = totals.map((item) => item.tokens).sort((a, b) => a - b);
  const usd = totals.map((item) => item.usd).sort((a, b) => a - b);
  return {
    sessionCount: totals.length,
    skippedWithoutSession,
    medianTokens: percentile(tokens, 0.5),
    p90Tokens: percentile(tokens, 0.9),
    medianUsd: percentile(usd, 0.5),
    p90Usd: percentile(usd, 0.9),
  };
}

export function formatSummary(summary: SessionCostSummary, placeholder: boolean): string {
  const money = (value: number) => value.toFixed(4);
  const lines = [
    placeholder ? "Prices are PLACEHOLDERS. Verify scripts/pricing.json before any go/no-go." : "Prices loaded from scripts/pricing.json.",
    `Sessions: ${summary.sessionCount}`,
    `Rows skipped (no sessionId): ${summary.skippedWithoutSession}`,
    `Median tokens per session: ${summary.medianTokens.toFixed(1)}`,
    `P90 tokens per session: ${summary.p90Tokens.toFixed(1)}`,
    `Median estimated USD per session: ${money(summary.medianUsd)}`,
    `P90 estimated USD per session: ${money(summary.p90Usd)}`,
  ];
  return lines.join("\n");
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
  console.log(formatSummary(summary, pricing.placeholder !== false));
}

const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (/(^|\/)cost-report\.(ts|js|mjs)$/.test(entry)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "cost report failed";
    console.error(message);
    process.exit(1);
  });
}
