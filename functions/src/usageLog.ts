import { costMicrosForUsage } from "./pricing";

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface UsageRecord {
  uid: string;
  sessionId: string | null;
  reservationId: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  /** Candidate tokens plus thinking tokens. Thinking is billed as output. */
  completionTokens: number;
  thoughtsTokenCount: number;
  /** Budget sent on this call. Null when thinkingConfig was not set. */
  thinkingBudget: number | null;
  costMicros: number;
  ts?: unknown;
}

export interface UsageLogLine {
  reservationId: string | null;
  uid: string;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  thoughtsTokenCount: number;
  thinkingBudget: number | null;
  costMicros: number;
}

const USAGE_FIELDS = [
  "uid",
  "sessionId",
  "reservationId",
  "feature",
  "model",
  "promptTokens",
  "completionTokens",
  "thoughtsTokenCount",
  "thinkingBudget",
  "costMicros",
  "ts",
] as const;

export function tokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function usageFromChunks(chunks: Array<{
  text?: string;
  usageMetadata?: UsageMetadata | null;
} | null | undefined>): {
  promptTokens: number;
  completionTokens: number;
  thoughtsTokenCount: number;
} {
  let promptTokens = 0;
  let candidates = 0;
  let thoughtsTokenCount = 0;
  for (const chunk of chunks) {
    const meta = chunk?.usageMetadata;
    if (!meta) continue;
    promptTokens = tokenCount(meta.promptTokenCount);
    candidates = tokenCount(meta.candidatesTokenCount);
    thoughtsTokenCount = tokenCount(meta.thoughtsTokenCount);
  }
  return {
    promptTokens,
    thoughtsTokenCount,
    completionTokens: candidates + thoughtsTokenCount,
  };
}

export function buildUsageRecord(input: {
  uid: string;
  sessionId: string | null;
  reservationId?: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  thoughtsTokenCount?: number;
  thinkingBudget?: number | null;
  ts?: unknown;
}): UsageRecord {
  const promptTokens = tokenCount(input.promptTokens);
  const completionTokens = tokenCount(input.completionTokens);
  const thoughtsTokenCount = tokenCount(input.thoughtsTokenCount);
  const thinkingBudget = typeof input.thinkingBudget === "number" && Number.isFinite(input.thinkingBudget)
    ? Math.min(8192, Math.max(0, Math.floor(input.thinkingBudget)))
    : null;
  const record: UsageRecord = {
    uid: input.uid,
    sessionId: input.sessionId,
    reservationId: input.reservationId ?? null,
    feature: input.feature,
    model: input.model,
    promptTokens,
    completionTokens,
    thoughtsTokenCount,
    thinkingBudget,
    costMicros: costMicrosForUsage({
      model: input.model,
      promptTokens,
      completionTokens,
    }),
  };
  if (input.ts !== undefined) record.ts = input.ts;
  return record;
}

/** One secret-free line. Message text, prompts, and keys are not fields on this object. */
export function usageLogLine(record: UsageRecord): UsageLogLine {
  const costMicros = typeof record.costMicros === "number" && Number.isFinite(record.costMicros) && record.costMicros >= 0
    ? Math.round(record.costMicros)
    : costMicrosForUsage(record);
  return {
    reservationId: typeof record.reservationId === "string" && record.reservationId.length > 0
      ? record.reservationId
      : null,
    uid: record.uid,
    feature: record.feature,
    model: record.model,
    promptTokens: tokenCount(record.promptTokens),
    completionTokens: tokenCount(record.completionTokens),
    thoughtsTokenCount: tokenCount(record.thoughtsTokenCount),
    thinkingBudget: typeof record.thinkingBudget === "number" && Number.isFinite(record.thinkingBudget)
      ? Math.max(0, Math.floor(record.thinkingBudget))
      : null,
    costMicros,
  };
}

export function usageRecordKeys(record: UsageRecord): string[] {
  return Object.keys(record).filter((key) => (USAGE_FIELDS as readonly string[]).includes(key));
}

export function judgeUsageRecord(input: {
  uid: string;
  sessionId: string | null;
  reservationId?: string | null;
  model: string;
  ts?: unknown;
}): UsageRecord {
  return buildUsageRecord({
    uid: input.uid,
    sessionId: input.sessionId,
    reservationId: input.reservationId ?? null,
    feature: "judge",
    model: input.model,
    promptTokens: 0,
    completionTokens: 0,
    ts: input.ts,
  });
}
