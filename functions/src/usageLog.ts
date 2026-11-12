import { costMicrosForUsage } from "./pricing";

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface UsageRecord {
  uid: string;
  sessionId: string | null;
  reservationId: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
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
} {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const chunk of chunks) {
    const meta = chunk?.usageMetadata;
    if (!meta) continue;
    promptTokens = tokenCount(meta.promptTokenCount);
    completionTokens = tokenCount(meta.candidatesTokenCount);
  }
  return { promptTokens, completionTokens };
}

export function buildUsageRecord(input: {
  uid: string;
  sessionId: string | null;
  reservationId?: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ts?: unknown;
}): UsageRecord {
  const promptTokens = tokenCount(input.promptTokens);
  const completionTokens = tokenCount(input.completionTokens);
  const record: UsageRecord = {
    uid: input.uid,
    sessionId: input.sessionId,
    reservationId: input.reservationId ?? null,
    feature: input.feature,
    model: input.model,
    promptTokens,
    completionTokens,
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
