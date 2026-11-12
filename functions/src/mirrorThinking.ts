import { normalizeModelName } from "./modelRouter";

/** Welcome is question 1. The reply after this many user answers is the scoring turn. */
export const MIRROR_FINAL_ANSWER_COUNT = 5;
export const DEFAULT_MIRROR_FINAL_THINKING_BUDGET = 1024;
export const MAX_MIRROR_THINKING_BUDGET = 8192;
const MIRROR_FLASH = "gemini-2.5-flash";

export interface ThinkingDecision {
  /**
   * Present only for a gemini-2.5-flash Mirror call.
   * 0 disables thinking. Omitted means leave the model default alone.
   */
  thinkingBudget?: number;
  /** Client turnIndex / isFinalTurn were absent or matched the counted user answers. */
  clientAgrees: boolean;
}

/** 0 disables thinking. Missing or non-numeric values use the default. */
export function clampThinkingBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MIRROR_FINAL_THINKING_BUDGET;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MIRROR_FINAL_THINKING_BUDGET;
  return Math.min(MAX_MIRROR_THINKING_BUDGET, Math.max(0, Math.floor(parsed)));
}

export function countUserAnswers(messages: Array<{ role?: string; content?: string }>): number {
  return messages.filter((message) => (
    message.role === "user"
    && typeof message.content === "string"
    && message.content.trim().length > 0
  )).length;
}

function clientTurnAgrees(
  turnIndex: unknown,
  isFinalTurn: unknown,
  counted: number,
  finalByCount: boolean,
): boolean {
  const indexAgrees = turnIndex === undefined
    || (typeof turnIndex === "number" && Number.isFinite(turnIndex) && Math.floor(turnIndex) === counted);
  const flagAgrees = isFinalTurn === undefined || isFinalTurn === finalByCount;
  return indexAgrees && flagAgrees;
}

/**
 * Question replies (answers 1-4) use thinking budget 0.
 * The scoring reply uses MIRROR_FINAL_THINKING_BUDGET.
 * The counted user messages decide. Client turn fields cannot raise an
 * early budget or skip the scoring budget.
 */
export function mirrorThinkingBudget(input: {
  feature: string;
  model: string;
  messages: Array<{ role?: string; content?: string }>;
  turnIndex?: unknown;
  isFinalTurn?: unknown;
  envValue?: string;
}): ThinkingDecision {
  const counted = countUserAnswers(input.messages);
  const finalByCount = counted >= MIRROR_FINAL_ANSWER_COUNT;
  const clientAgrees = clientTurnAgrees(input.turnIndex, input.isFinalTurn, counted, finalByCount);
  const mirrorFlash = input.feature.trim().toLowerCase() === "mirror"
    && normalizeModelName(input.model) === MIRROR_FLASH;
  if (!mirrorFlash) return { clientAgrees };
  if (!finalByCount) return { thinkingBudget: 0, clientAgrees };
  return { thinkingBudget: clampThinkingBudget(input.envValue), clientAgrees };
}
