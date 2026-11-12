/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The welcome message is question 1. Scores are valid only after the 5th
 * user answer. Question labels in the model text are not a source of truth.
 */

export const MIRROR_QUESTION_COUNT = 5;

export interface TurnMessage {
  role: string;
  content?: string;
}

export interface MirrorTurn {
  turnIndex: number;
  isFinalTurn: boolean;
}

const SCORE_BLOCK = /JSON_SCORES:\s*(?:```json)?\s*(\{[\s\S]*?\})\s*(?:```)?/;
const QUESTION_LABEL = /\(\s*Question\s+\d+\s*\/\s*5\s*\)/gi;

export function userAnswerCount(messages: TurnMessage[]): number {
  return messages.filter((message) => (
    message.role === "user" && typeof message.content === "string" && message.content.trim().length > 0
  )).length;
}

/**
 * Question number for the model message at `index`.
 * Null once five user answers precede it: that reply is the scoring turn.
 */
export function questionNumberAt(messages: TurnMessage[], index: number): number | null {
  const priorAnswers = userAnswerCount(messages.slice(0, index));
  if (priorAnswers >= MIRROR_QUESTION_COUNT) return null;
  return priorAnswers + 1;
}

/** Fields for the chat request that includes this many user answers. */
export function mirrorTurnFields(answerCount: number): MirrorTurn {
  return {
    turnIndex: answerCount,
    isFinalTurn: answerCount >= MIRROR_QUESTION_COUNT,
  };
}

export function stripJsonScores(content: string): string {
  const index = content.indexOf("JSON_SCORES:");
  if (index === -1) return content;
  return content.slice(0, index).trimEnd();
}

export function parseScoreBlock(content: string): Record<string, unknown> | null {
  const match = content.match(SCORE_BLOCK);
  if (!match) return null;
  try {
    const scores = JSON.parse(match[1].trim()) as unknown;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) return null;
    return scores as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Scores count only after the 5th user answer, including on restore. */
export function scoresReady(messages: TurnMessage[]): boolean {
  if (userAnswerCount(messages) < MIRROR_QUESTION_COUNT) return false;
  const lastModel = [...messages].reverse().find((message) => message.role === "model");
  return Boolean(lastModel?.content && parseScoreBlock(lastModel.content));
}

export function stampQuestionLabel(content: string, questionNumber: number | null): string {
  if (questionNumber === null) {
    return content.replace(QUESTION_LABEL, "").replace(/[ \t]{2,}/g, " ").trimEnd();
  }
  const label = `(Question ${questionNumber}/5)`;
  if (/\(\s*Question\s+\d+\s*\/\s*5\s*\)/i.test(content)) {
    return content.replace(QUESTION_LABEL, label);
  }
  const trimmed = content.trimEnd();
  return trimmed ? `${trimmed} ${label}` : label;
}

/** One follow-up when the model tries to score before five answers exist. */
export function continuationInstruction(answerCount: number): string {
  const next = Math.min(MIRROR_QUESTION_COUNT, answerCount + 1);
  return `You have received ${answerCount} of ${MIRROR_QUESTION_COUNT} answers. Ask only the next scenario (Question ${next}/5). Do not output JSON_SCORES.`;
}
