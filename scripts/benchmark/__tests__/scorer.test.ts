/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MIRROR_SYSTEM_PROMPT } from '../../../src/constants';
import { buildJudgeSystemPrompt, parseMirrorScores } from '../scorer';
import { neutralScores } from './fixture';

describe('Mirror scorer', () => {
  it('parses the same JSON_SCORES block the Mirror UI accepts', () => {
    const scores = neutralScores({ openness: 85, neuroticism: 12 });
    const fenced = `Notes\nJSON_SCORES:\n\`\`\`json\n${JSON.stringify(scores)}\n\`\`\``;
    expect(parseMirrorScores(fenced)).toEqual(scores);
    expect(parseMirrorScores(`JSON_SCORES:\n${JSON.stringify(scores)}`)).toEqual(scores);
  });

  it('rejects out-of-range scores and missing blocks', () => {
    expect(() => parseMirrorScores('please rate yourself from 1 to 5')).toThrow(/JSON_SCORES/);
    expect(() => parseMirrorScores('JSON_SCORES:\n{"openness": 140, "conscientiousness": 1, "extroversion": 1, "agreeableness": 1, "neuroticism": 1}')).toThrow(/openness/);
  });

  it('scores behavior with the Mirror rubric and does not ask for a self-report questionnaire', () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain('Score the interviewee\'s BEHAVIOR');
    expect(prompt).toContain('Do not ask the interviewee to fill out a questionnaire');
    expect(prompt).toContain('JSON_SCORES:');
    expect(prompt).toContain('TRAIT BLEED / ASPECT DISAMBIGUATION');
    expect(prompt).toContain('Working overnight / taking on extra work');
    expect(MIRROR_SYSTEM_PROMPT).toContain('TRAIT BLEED / ASPECT DISAMBIGUATION');
  });
});
