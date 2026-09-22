/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlignmentJudgment,
  DialogueTurn,
  JevAnswers,
  JevQuestion,
  OceanJudgment,
  alignmentQuestions,
  buildAlignmentState,
  buildOceanState,
  interpretAlignmentAnswers,
  interpretOceanAnswers,
  oceanQuestions,
} from '../jev/questions';
import { OceanScores } from '../types';

const JUDGE_TIMEOUT_MS = 12000;

function getJudgeUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'cognitive-bridge-ai';
  if (
    typeof window !== 'undefined'
    && (window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.hostname === '0.0.0.0')
  ) {
    return `http://localhost:5001/${projectId}/us-central1/judgeProxy`;
  }
  return '/api/judge';
}

export async function requestJudgment(
  state: string,
  questions: Record<string, JevQuestion>
): Promise<JevAnswers | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const response = await fetch(getJudgeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, questions }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json() as { unavailable?: boolean; answers?: JevAnswers };
    if (data.unavailable || !data.answers) return null;
    return data.answers;
  } catch (error) {
    console.warn('Jev judge unavailable:', error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function judgeOcean(
  messages: DialogueTurn[],
  scores: OceanScores
): Promise<OceanJudgment | null> {
  const answers = await requestJudgment(buildOceanState(messages, scores), oceanQuestions(scores));
  if (!answers) return null;
  return interpretOceanAnswers(scores, answers);
}

export async function judgeAlignment(input: {
  scores: OceanScores;
  userQuery: string;
  alignedReply: string;
  unalignedReply: string;
}): Promise<AlignmentJudgment | null> {
  const answers = await requestJudgment(buildAlignmentState(input), alignmentQuestions());
  if (!answers) return null;
  return interpretAlignmentAnswers(answers);
}
