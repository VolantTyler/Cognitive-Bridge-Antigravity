/**
 * PLACEHOLDER prices in USD per 1,000,000 tokens.
 * Verify against the current Vertex AI / Gemini price card before any
 * go/no-go. Retune this one module; the cost cap and scripts/cost-report.ts
 * both read it. These numbers are not authoritative.
 */

export interface PriceRow {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  perCallUsd?: number;
}

export interface PricingTable {
  placeholder: boolean;
  comment: string;
  models: Record<string, PriceRow>;
  default: PriceRow;
}

export const PRICING: PricingTable = {
  placeholder: true,
  comment: "PLACEHOLDER prices in USD per 1,000,000 tokens. Verify against the current Vertex AI / Gemini price card before any cost go/no-go. These numbers are not authoritative.",
  models: {
    "gemini-2.5-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    "gemini-2.5-flash-lite": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
    "gemini-3.5-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    "gemini-3.1-pro-preview": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
    "gemini-3.8-flash": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
    "jev-latest": { inputPerMillionUsd: 0, outputPerMillionUsd: 0, perCallUsd: 0 },
  },
  default: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
};

export const USD_MICROS = 1_000_000;

export function highestPrice(table: PricingTable = PRICING): PriceRow {
  let best: PriceRow = table.default;
  let bestScore = -1;
  for (const row of Object.values(table.models)) {
    const score = row.inputPerMillionUsd + row.outputPerMillionUsd + (row.perCallUsd ?? 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/** Unknown models use the most expensive known card so the cap does not under-count. */
export function priceForModel(model: string | undefined, table: PricingTable = PRICING): PriceRow {
  if (model && table.models[model]) return table.models[model];
  return highestPrice(table);
}

export function costUsdForUsage(input: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}, table: PricingTable = PRICING): number {
  const price = priceForModel(input.model, table);
  const prompt = finiteTokens(input.promptTokens);
  const completion = finiteTokens(input.completionTokens);
  return (prompt / 1_000_000) * price.inputPerMillionUsd
    + (completion / 1_000_000) * price.outputPerMillionUsd
    + (price.perCallUsd ?? 0);
}

export function costMicrosForUsage(input: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}, table: PricingTable = PRICING): number {
  const usd = costUsdForUsage(input, table);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * USD_MICROS);
}

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * USD_MICROS);
}

function finiteTokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
