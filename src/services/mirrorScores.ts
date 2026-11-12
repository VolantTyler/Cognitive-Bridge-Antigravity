/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parses the Mirror's JSON_SCORES block. A literal `<0-100>` placeholder,
 * any non-numeric value, or a score outside 0–100 is rejected so callers
 * can use their existing retry path.
 */

import type { OceanScores } from '../types';

export const OCEAN_SCORE_TRAITS = [
  'openness',
  'conscientiousness',
  'extroversion',
  'agreeableness',
  'neuroticism',
] as const;

const SCORE_PATTERN = /JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/;

export class MirrorScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MirrorScoreError';
  }
}

function scoreValue(trait: (typeof OCEAN_SCORE_TRAITS)[number], value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new MirrorScoreError(`JSON_SCORES.${trait} must be a number from 0 to 100`);
  }
  return value;
}

export function parseMirrorScores(content: string): OceanScores {
  const match = content.match(SCORE_PATTERN);
  if (!match) {
    throw new MirrorScoreError('Mirror score response is missing a JSON_SCORES block');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch (error) {
    throw new MirrorScoreError(`JSON_SCORES block is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MirrorScoreError('JSON_SCORES block must be an object');
  }
  const record = parsed as Record<string, unknown>;
  return {
    openness: scoreValue('openness', record.openness),
    conscientiousness: scoreValue('conscientiousness', record.conscientiousness),
    extroversion: scoreValue('extroversion', record.extroversion),
    agreeableness: scoreValue('agreeableness', record.agreeableness),
    neuroticism: scoreValue('neuroticism', record.neuroticism),
  };
}
