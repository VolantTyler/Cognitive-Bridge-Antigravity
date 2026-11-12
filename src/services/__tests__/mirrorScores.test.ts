/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseMirrorScores } from '../mirrorScores';

const placeholder = `JSON_SCORES:
{
  "openness": <0-100>,
  "conscientiousness": <0-100>,
  "extroversion": <0-100>,
  "agreeableness": <0-100>,
  "neuroticism": <0-100>
}`;

describe('parseMirrorScores', () => {
  it('rejects the literal <0-100> placeholder', () => {
    expect(() => parseMirrorScores(placeholder)).toThrow(/JSON_SCORES/);
    expect(() => parseMirrorScores(placeholder.replaceAll('<0-100>', '"<0-100>"'))).toThrow(/openness/);
  });

  it('rejects non-numeric and out-of-range scores', () => {
    const block = (openness: string) => `JSON_SCORES:\n{"openness": ${openness}, "conscientiousness": 1, "extroversion": 1, "agreeableness": 1, "neuroticism": 1}`;
    expect(() => parseMirrorScores(block('"high"'))).toThrow(/openness/);
    expect(() => parseMirrorScores(block('true'))).toThrow(/openness/);
    expect(() => parseMirrorScores(block('140'))).toThrow(/openness/);
    expect(() => parseMirrorScores(block('-1'))).toThrow(/openness/);
  });

  it('accepts a numeric block inside the 0 to 100 range', () => {
    expect(parseMirrorScores('JSON_SCORES:\n{"openness": 0, "conscientiousness": 45, "extroversion": 50, "agreeableness": 85, "neuroticism": 100}')).toEqual({
      openness: 0,
      conscientiousness: 45,
      extroversion: 50,
      agreeableness: 85,
      neuroticism: 100,
    });
  });
});
