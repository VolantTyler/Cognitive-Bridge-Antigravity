/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../config';
import { costUsd } from '../cost';
import { estimateDryRun, estimateJudgeInputTokens, formatDryRun } from '../dryrun';
import { interviewMessages } from '../openrouter';
import { estimateMessagesTokens } from '../tokens';
import { main } from '../main';
import { testConfig } from './fixture';

describe('dry-run estimate', () => {
  it('uses real prompt tokens, max output tokens, and judge calls, and does not touch the network', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network should not be called');
    };
    try {
      const config = testConfig({
        repeats: 2,
        maxOutputTokens: 10,
        judgeMaxOutputTokens: 7,
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 2, outputPerMillionUsd: 4 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
          { id: 'x-ai/grok-4.3', enabled: true, inputPerMillionUsd: null, outputPerMillionUsd: null },
        ],
      });
      const scenarios = [{ id: 'tiny', text: 'abcd' }];
      const estimate = estimateDryRun(config, scenarios);
      const interviewInput = 2 * estimateMessagesTokens(interviewMessages(null, 'abcd'));
      const interviewOutput = 2 * 10;
      const interviewCost = costUsd(interviewInput, interviewOutput, {
        id: 'openai/gpt-5-nano',
        inputPerMillionUsd: 2,
        outputPerMillionUsd: 4,
      });
      const judgeInput = 2 * estimateJudgeInputTokens(scenarios, 10);
      const judgeCost = costUsd(judgeInput, 2 * 7, {
        id: 'google/gemini-2.5-flash-lite',
        inputPerMillionUsd: 0.1,
        outputPerMillionUsd: 0.4,
      });
      const nano = estimate.models.find((model) => model.id === 'openai/gpt-5-nano');
      expect(nano?.interviewCalls).toBe(2);
      expect(nano?.judgeCalls).toBe(2);
      expect(nano?.interviewInputTokens).toBe(interviewInput);
      expect(nano?.interviewOutputTokens).toBe(interviewOutput);
      expect(nano?.interviewCostUsd).toBeCloseTo(interviewCost);
      expect(nano?.judgeCostUsd).toBeCloseTo(judgeCost);
      expect(nano?.totalCostUsd).toBeCloseTo(interviewCost + judgeCost);
      expect(estimate.totalCostUsd).toBeGreaterThan(interviewCost);
      expect(estimate.models.map((model) => model.id)).not.toContain('x-ai/grok-4.3');
      expect(estimate.skipped).toContainEqual({ id: 'x-ai/grok-4.3', reason: 'no price' });
      expect(interviewMessages(null, 'abcd')).toEqual([{ role: 'user', content: 'abcd' }]);

      const longer = estimateDryRun(config, [{ id: 'tiny', text: 'abcd abcd abcd abcd' }]);
      expect(longer.models[0].interviewInputTokens).toBeGreaterThan(nano?.interviewInputTokens ?? 0);

      const text = formatDryRun(estimate);
      expect(text).toContain('No network calls were made.');
      expect(text).toContain('System prompt: none');
      expect(text).toMatch(/Total estimated USD: \$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('prints the shipped estimate without reading or echoing an API key', async () => {
    const lines: string[] = [];
    const code = await main(['--dry-run'], {
      env: { OPENROUTER_API_KEY: 'sk-test-should-not-appear' },
      stdout: (message) => lines.push(message),
      stderr: (message) => lines.push(message),
    });
    expect(code).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('No network calls were made.');
    expect(output).not.toContain('sk-test-should-not-appear');
    expect(output).toContain('openai/gpt-5-nano');
    expect(output).toContain('anthropic/claude-haiku-4.5');
    expect(output).toContain('x-ai/grok-4.3');
    const shipped = estimateDryRun(loadConfig());
    expect(shipped.models).toHaveLength(4);
    expect(shipped.scenarioCount).toBe(5);
    expect(shipped.repeats).toBe(5);
    expect(shipped.temperature).toBe(0.8);
    expect(shipped.systemPrompt).toBeNull();
    expect(output).toContain(`Total estimated USD: $${shipped.totalCostUsd.toFixed(6)}`);
  });

  it('treats a blank system prompt as none', () => {
    const config = testConfig({ systemPrompt: '   ' });
    expect(config.interview.systemPrompt).toBeNull();
    expect(parseConfig({
      ...JSON.parse(JSON.stringify(config)),
      interview: { ...config.interview, systemPrompt: null },
    }).interview.systemPrompt).toBeNull();
  });
});
