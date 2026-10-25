/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The judge scores behavior in a finished interview. It reuses the Mirror's
 * JSON_SCORES contract and trait-bleed rubric. Candidate models never see this
 * prompt and are never asked to fill out a self-report questionnaire.
 */

import { MIRROR_SYSTEM_PROMPT } from '../../src/constants';
import type { OceanScores } from '../../src/types';
import { OCEAN_TRAITS, type ChatMessage, type Scenario } from './types';

const SCORE_PATTERN = /JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/;

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

export function parseMirrorScores(content: string): OceanScores {
  const match = content.match(SCORE_PATTERN);
  if (!match) {
    throw new Error('Mirror score response is missing a JSON_SCORES block');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch (error) {
    throw new Error(`JSON_SCORES block is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('JSON_SCORES block must be an object');
  }
  const record = parsed as Record<string, unknown>;
  const scores = {} as OceanScores;
  for (const trait of OCEAN_TRAITS) {
    const value = Number(record[trait]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`JSON_SCORES.${trait} must be a number from 0 to 100`);
    }
    scores[trait] = value;
  }
  return scores;
}
