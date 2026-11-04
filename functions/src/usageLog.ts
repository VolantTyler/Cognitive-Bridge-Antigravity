export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface UsageRecord {
  uid: string;
  sessionId: string | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ts?: unknown;
}

const USAGE_FIELDS = [
  "uid",
  "sessionId",
  "feature",
  "model",
  "promptTokens",
  "completionTokens",
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
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ts?: unknown;
}): UsageRecord {
  const record: UsageRecord = {
    uid: input.uid,
    sessionId: input.sessionId,
    feature: input.feature,
    model: input.model,
    promptTokens: tokenCount(input.promptTokens),
    completionTokens: tokenCount(input.completionTokens),
  };
  if (input.ts !== undefined) record.ts = input.ts;
  return record;
}

export function usageRecordKeys(record: UsageRecord): string[] {
  return Object.keys(record).filter((key) => (USAGE_FIELDS as readonly string[]).includes(key));
}

export function judgeUsageRecord(input: {
  uid: string;
  sessionId: string | null;
  model: string;
  ts?: unknown;
}): UsageRecord {
  return buildUsageRecord({
    uid: input.uid,
    sessionId: input.sessionId,
    feature: "judge",
    model: input.model,
    promptTokens: 0,
    completionTokens: 0,
    ts: input.ts,
  });
}
