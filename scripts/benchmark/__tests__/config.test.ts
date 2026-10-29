/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { INITIAL_MIRROR_MESSAGE, MIRROR_SYSTEM_PROMPT } from '../../../src/constants';
import { loadConfig, parseConfig, runnableModels, skippedModels } from '../config';
import { ConfigError } from '../errors';
import { interviewScenarios } from '../scenarios';

describe('shipped benchmark config', () => {
  const config = loadConfig();

  it('pins the four priced models, neutral interview settings, and cost limits', () => {
    expect(config.priceDate).toBe('2026-10-05');
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(config.interview.systemPrompt).toBeNull();
    expect(config.interview.temperature).toBe(0.8);
    expect(config.interview.repeats).toBe(10);
    expect(config.interview.maxOutputTokens).toBe(8192);
    expect(config.interview.retryMaxOutputTokens).toBe(16384);
    expect(config.interview.reasoningEffort).toBe('minimal');
    expect(config.judge.maxOutputTokens).toBe(config.interview.maxOutputTokens);
    expect(config.judge.modelId).toBe('google/gemini-2.5-flash-lite');
    expect(config.judge.temperature).toBe(0);
    expect(config.limits).toEqual({ warnPerRunUsd: 10, hardStopPerRunUsd: 15, warnPerMonthUsd: 40 });
    expect(config.traitConfidence.extroversion).toBe('low');
    expect(runnableModels(config).map((model) => [model.id, model.inputPerMillionUsd, model.outputPerMillionUsd])).toEqual([
      ['openai/gpt-5-nano', 0.05, 0.4],
      ['google/gemini-2.5-flash-lite', 0.1, 0.4],
      ['anthropic/claude-haiku-4.5', 1, 5],
      ['x-ai/grok-4.3', 1.25, 2.5],
    ]);
    expect(config.models.filter((model) => model.enabled)).toHaveLength(4);
  });

  it('rejects a fifth enabled model and a zero interview temperature', () => {
    const raw = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    const models = (raw.models as unknown[]).concat({
      id: 'extra/model',
      enabled: true,
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 1,
    });
    expect(() => parseConfig({ ...raw, models })).toThrow(ConfigError);
    expect(() => parseConfig({ ...raw, models })).toThrow(/fifth|At most 4/);
    expect(() => parseConfig({
      ...raw,
      interview: { ...(raw.interview as object), temperature: 0 },
    })).toThrow(/must not be 0/);
  });

  it('skips an enabled model that has no price', () => {
    const raw = JSON.parse(JSON.stringify(config)) as { models: Array<Record<string, unknown>> };
    raw.models[3].inputPerMillionUsd = null;
    const parsed = parseConfig(raw);
    expect(skippedModels(parsed)).toContainEqual({ id: 'x-ai/grok-4.3', reason: 'no price' });
    expect(runnableModels(parsed).map((model) => model.id)).not.toContain('x-ai/grok-4.3');
  });
});

describe('interview scenarios', () => {
  const scenarios = interviewScenarios();

  it('keeps five scenarios in a fixed order, including the product probes', () => {
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'demo-bug',
      'novelty-rewrite',
      'solo-or-room',
      'plain-challenge',
      'waived-deadline',
    ]);
    expect(INITIAL_MIRROR_MESSAGE).toContain(scenarios[0].text);
    expect(MIRROR_SYSTEM_PROMPT).toContain('Management officially waives the deadline');
    expect(scenarios[4].text).toContain('Management officially waives the deadline');
    for (const scenario of scenarios) {
      expect(scenario.text.toLowerCase()).not.toMatch(/on a scale|rate your|how open are you/);
    }
  });
});
