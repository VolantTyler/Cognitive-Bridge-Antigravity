/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseScoreBlock, scoresReady, type TurnMessage } from './interviewTurns';

const placeholder = `JSON_SCORES:
{
  "openness": <0-100>,
  "conscientiousness": <0-100>,
  "extroversion": <0-100>,
  "agreeableness": <0-100>,
  "neuroticism": <0-100>
}`;

function fiveAnswers(last: string): TurnMessage[] {
  const messages: TurnMessage[] = [{ role: 'model', content: 'Welcome' }];
  for (let i = 1; i <= 5; i += 1) {
    messages.push({ role: 'user', content: `Answer ${i}` });
  }
  messages.push({ role: 'model', content: last });
  return messages;
}

describe('score gate', () => {
  it('rejects the literal <0-100> placeholder after the fifth answer', () => {
    expect(parseScoreBlock(placeholder)).toBeNull();
    expect(scoresReady(fiveAnswers(placeholder))).toBe(false);
    const quoted = placeholder.replaceAll('<0-100>', '"<0-100>"');
    expect(parseScoreBlock(quoted)).toBeNull();
    expect(scoresReady(fiveAnswers(quoted))).toBe(false);
  });

  it('accepts numeric scores only after five answers', () => {
    const block = 'JSON_SCORES:\n{"openness": 50, "conscientiousness": 45, "extroversion": 50, "agreeableness": 85, "neuroticism": 30}';
    expect(scoresReady([{ role: 'user', content: 'one' }, { role: 'model', content: block }])).toBe(false);
    expect(scoresReady(fiveAnswers(block))).toBe(true);
  });
});
