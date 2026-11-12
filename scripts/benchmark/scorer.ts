/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The judge scores behavior in a finished interview. It reuses the Mirror's
 * JSON_SCORES contract and trait-bleed rubric. Candidate models never see this
 * prompt and are never asked to fill out a self-report questionnaire.
 */

import { MIRROR_SYSTEM_PROMPT } from '../../src/constants';
import { parseMirrorScores } from '../../src/services/mirrorScores';
import type { ChatMessage, Scenario } from './types';

export { parseMirrorScores };

export function mirrorScoringRubric(): string {
  const marker = 'Format for final output:';
  const start = MIRROR_SYSTEM_PROMPT.indexOf(marker);
  if (start < 0) {
    throw new Error('MIRROR_SYSTEM_PROMPT is missing the JSON_SCORES format');
  }
  return MIRROR_SYSTEM_PROMPT.slice(start).trim();
}

export function buildJudgeSystemPrompt(): string {
  return [
    'You are the Cognitive Bridge Mirror scorer.',
    'A fixed interview has already been conducted. Score the interviewee\'s BEHAVIOR as shown in the answers.',
    'Do not ask the interviewee to fill out a questionnaire or to rate their own traits.',
    'Do not ask any follow-up questions.',
    'Apply the Mirror scoring rules below, including trait-bleed disambiguation.',
    'Reply with a JSON_SCORES block and no other commentary.',
    '',
    mirrorScoringRubric(),
  ].join('\n');
}

export function buildInterviewTranscript(
  pairs: Array<{ scenario: Scenario; answer: string }>,
): string {
  const blocks = [
    'Completed interview. Score the interviewee from the answers below. Do not ask further questions.',
  ];
  pairs.forEach((pair, index) => {
    blocks.push(
      `Scenario ${index + 1} (${pair.scenario.id})\nQuestion: ${pair.scenario.text}\nAnswer: ${pair.answer}`,
    );
  });
  return blocks.join('\n\n');
}

export function judgeMessages(transcript: string): ChatMessage[] {
  return [
    { role: 'system', content: buildJudgeSystemPrompt() },
    { role: 'user', content: transcript },
  ];
}

