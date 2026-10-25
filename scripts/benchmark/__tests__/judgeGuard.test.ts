/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { JudgeMixError } from '../errors';
import { assertJudgeMixAllowed, versionsAgree } from '../scorefile';

const stored = { modelId: 'google/gemini-2.5-flash-lite', version: 'google/gemini-2.5-flash-lite-001' };

describe('judge version guard', () => {
  it('refuses to mix a stored judge version that differs from the current config', () => {
    expect(() => assertJudgeMixAllowed({
      stored,
      configJudge: { modelId: 'google/gemini-2.5-flash-lite', version: 'google/gemini-2.5-flash-lite-002' },
      rescoreAll: false,
    })).toThrow(JudgeMixError);
    expect(() => assertJudgeMixAllowed({
      stored,
      configJudge: { modelId: 'google/gemini-2.5-flash-lite', version: 'google/gemini-2.5-flash-lite-002' },
      rescoreAll: false,
    })).toThrow(/--rescore-all/);

    expect(() => assertJudgeMixAllowed({
      stored,
      configJudge: { modelId: 'openai/gpt-5-nano', version: null },
      rescoreAll: false,
    })).toThrow(/differs from the current config/);
  });

  it('allows the same pin and allows --rescore-all to replace a different judge', () => {
    expect(() => assertJudgeMixAllowed({
      stored,
      configJudge: { modelId: stored.modelId, version: stored.version },
      rescoreAll: false,
    })).not.toThrow();
    expect(() => assertJudgeMixAllowed({
      stored,
      configJudge: { modelId: 'openai/gpt-5-nano', version: 'other' },
      rescoreAll: true,
    })).not.toThrow();
    expect(() => versionsAgree(stored.version, 'google/gemini-2.5-flash-lite-009')).toThrow(/--rescore-all/);
    expect(() => versionsAgree(stored.version, stored.version)).not.toThrow();
    expect(() => versionsAgree(null, 'google/gemini-2.5-flash-lite-001')).not.toThrow();
  });
});
