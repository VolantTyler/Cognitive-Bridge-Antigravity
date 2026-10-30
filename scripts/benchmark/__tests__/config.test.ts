/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { INITIAL_MIRROR_MESSAGE, MIRROR_SYSTEM_PROMPT } from '../../../src/constants';
import { DEFAULT_CONFIG_PATH, loadConfig, parseConfig, runnableModels, skippedModels } from '../config';
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
    expect(config.maxEnabledModels).toBe(12);
    expect(config.runLabel).toBe('default');
    expect(config.models.every((model) => model.provider === undefined)).toBe(true);
    expect(config.traitConfidence.extroversion).toBe('low');
    expect(runnableModels(config).map((model) => [model.id, model.inputPerMillionUsd, model.outputPerMillionUsd])).toEqual([
      ['openai/gpt-5-nano', 0.05, 0.4],
      ['google/gemini-2.5-flash-lite', 0.1, 0.4],
      ['anthropic/claude-haiku-4.5', 1, 5],
      ['x-ai/grok-4.3', 1.25, 2.5],
    ]);
    expect(config.models.filter((model) => model.enabled)).toHaveLength(4);
    expect(config.models.filter((model) => !model.enabled).map((model) => [model.id, model.inputPerMillionUsd, model.outputPerMillionUsd])).toEqual([
      ['deepseek/deepseek-v4-flash', 0.091, 0.182],
      ['z-ai/glm-4.7-flash', 0.061, 0.4],
      ['stepfun/step-3.5-flash', 0.1, 0.3],
      ['qwen/qwen3-235b-a22b-2507', 0.09, 0.55],
      ['minimax/minimax-m2.7', 0.3, 1.2],
      ['moonshotai/kimi-k2-0905', 0.6, 2.5],
    ]);
    expect(skippedModels(config).map((model) => model.reason)).toEqual([
      'disabled',
      'disabled',
      'disabled',
      'disabled',
      'disabled',
      'disabled',
    ]);
  });

  it('allows more than four enabled models up to maxEnabledModels', () => {
    const raw = JSON.parse(JSON.stringify(config)) as {
      models: Array<{ id: string; enabled: boolean }>;
      maxEnabledModels: number;
    };
    const five = raw.models.map((model, index) => ({ ...model, enabled: index < 5 }));
    expect(parseConfig({ ...raw, models: five }).models.filter((model) => model.enabled)).toHaveLength(5);
    const extras = Array.from({ length: 9 }, (_, index) => ({
      id: `extra/model-${index}`,
      enabled: true,
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 1,
    }));
    expect(() => parseConfig({ ...raw, models: [...raw.models, ...extras] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...raw, models: [...raw.models, ...extras] })).toThrow(/At most 12 models may be enabled \(found 13\)/);
    expect(() => parseConfig({ ...raw, maxEnabledModels: 3 })).toThrow(/At most 3 models may be enabled \(found 4\)/);
    expect(() => parseConfig({ ...raw, maxEnabledModels: 0 })).toThrow(/positive integer/);
  });

  it('defaults a missing run_label and rejects a blank or long one', () => {
    const raw = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    delete raw.run_label;
    expect(parseConfig(raw).runLabel).toBe('default');
    expect(parseConfig({ ...raw, run_label: '  october open  ' }).runLabel).toBe('october open');
    expect(() => parseConfig({ ...raw, run_label: '   ' })).toThrow(/non-empty/);
    expect(() => parseConfig({ ...raw, run_label: 'x'.repeat(81) })).toThrow(/80 characters/);
    expect(() => parseConfig({ ...raw, run_label: 4 })).toThrow(/must be a string/);
  });

  it('accepts an interview provider pin and rejects a bad one', () => {
    const raw = JSON.parse(JSON.stringify(config)) as { models: Array<Record<string, unknown>> };
    raw.models[4] = {
      ...raw.models[4],
      provider: { order: [' ProviderName '], allow_fallbacks: false },
    };
    const parsed = parseConfig(raw);
    expect(parsed.models[4].provider).toEqual({ order: ['ProviderName'], allow_fallbacks: false });
    expect(parsed.models[0].provider).toBeUndefined();
    expect(() => parseConfig({
      ...raw,
      models: [{ ...raw.models[0], provider: {} }],
    })).toThrow(/needs order or allow_fallbacks/);
    expect(() => parseConfig({
      ...raw,
      models: [{ ...raw.models[0], provider: { order: ['ProviderName'], only: ['ProviderName'] } }],
    })).toThrow(/not supported/);
    expect(() => parseConfig({
      ...raw,
      models: [{ ...raw.models[0], provider: { order: [] } }],
    })).toThrow(/non-empty array/);
  });

  it('rejects a zero interview temperature', () => {
    const raw = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
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

describe('frontier benchmark config', () => {
  const frontierPath = path.join(path.dirname(DEFAULT_CONFIG_PATH), 'config.frontier.json');
  const frontier = loadConfig(frontierPath);
  const shipped = loadConfig();

  it('enables exactly the four near-frontier models and keeps the default settings', () => {
    expect(frontier.runLabel).toBe('frontier');
    expect(frontier.priceDate).toBe('2026-10-30');
    expect(frontier.interview).toEqual(shipped.interview);
    expect(frontier.judge).toEqual(shipped.judge);
    expect(frontier.limits).toEqual(shipped.limits);
    expect(frontier.maxEnabledModels).toBe(shipped.maxEnabledModels);
    expect(frontier.paths).toEqual(shipped.paths);
    expect(frontier.traitConfidence).toEqual(shipped.traitConfidence);
    expect(runnableModels(frontier).map((model) => [model.id, model.inputPerMillionUsd, model.outputPerMillionUsd])).toEqual([
      ['google/gemini-3.8-flash', 0.825, 4.125],
      ['x-ai/grok-4.7', 2, 6],
      ['anthropic/claude-opus-5.5', 4, 20],
      ['openai/gpt-6-luna', 0.1, 0.5],
    ]);
    expect(skippedModels(frontier)).toEqual([
      { id: 'google/gemini-2.5-flash-lite', reason: 'disabled' },
    ]);
    expect(frontier.models.find((model) => model.id === 'google/gemini-2.5-flash-lite')).toMatchObject({
      enabled: false,
      inputPerMillionUsd: 0.1,
      outputPerMillionUsd: 0.4,
    });
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
