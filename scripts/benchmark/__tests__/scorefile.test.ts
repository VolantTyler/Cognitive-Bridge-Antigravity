/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { ScoreFileSchemaError } from '../errors';
import { buildScoreFile, validateScoreFile, type CompletedModelRun } from '../scorefile';
import { HYPOTHESIS_LABEL, OCEAN_TRAITS } from '../types';
import { loadConfig } from '../config';
import { neutralScores } from './fixture';

function model(id: string, openness: number): CompletedModelRun {
  return {
    id,
    costUsd: 1.25,
    timestamp: '2026-10-25T03:00:00.000Z',
    repeats: [
      {
        repeat: 1,
        modelVersion: `${id}-2026-10-05`,
        judgeVersion: 'google/gemini-2.5-flash-lite-2026-10-05',
        scores: neutralScores({ openness }),
      },
    ],
  };
}

describe('score file schema', () => {
  it('writes a schema-versioned file with spread_warning, versions, cost, and trait stats', () => {
    const config = loadConfig();
    const scoreFile = buildScoreFile({
      models: [model('openai/gpt-5-nano', 40), model('google/gemini-2.5-flash-lite', 42)],
      judge: {
        modelId: config.judge.modelId,
        version: 'google/gemini-2.5-flash-lite-2026-10-05',
        temperature: 0,
      },
      interviewTemperature: 0.8,
      repeats: 5,
      generatedAt: '2026-10-25T03:04:00.000Z',
      priceDate: config.priceDate,
      wideRangeThreshold: config.wideRangeThreshold,
      spreadThreshold: config.spreadThreshold,
      traitConfidence: config.traitConfidence,
    });
    validateScoreFile(JSON.parse(JSON.stringify(scoreFile)));
    expect(scoreFile.schema_version).toBe(4);
    expect(scoreFile.output_budget).toMatchObject({
      max_output_tokens: 8192,
      retry_max_output_tokens: 16384,
      reasoning_effort: 'minimal',
    });
    expect(scoreFile.label).toBe(HYPOTHESIS_LABEL);
    expect(scoreFile.spread_warning).toBe(true);
    expect(scoreFile.judge.version).toBe('google/gemini-2.5-flash-lite-2026-10-05');
    expect(scoreFile.judge.recorded_at).toBe('2026-10-25T03:04:00.000Z');
    expect(scoreFile.models[0].runs[0].recorded_at).toBe('2026-10-25T03:00:00.000Z');
    expect(scoreFile.models[0].traits.openness.wide_range).toBe(false);
    expect(scoreFile.models[0].version).toBe('openai/gpt-5-nano-2026-10-05');
    expect(scoreFile.models[0].runs[0].model_version).toBe('openai/gpt-5-nano-2026-10-05');
    expect(scoreFile.models[0].cost_usd).toBe(1.25);
    expect(scoreFile.models[0].timestamp).toBe('2026-10-25T03:00:00.000Z');
    for (const trait of OCEAN_TRAITS) {
      const stats = scoreFile.models[0].traits[trait];
      expect(stats).toEqual(expect.objectContaining({
        runs: 1,
        confidence: config.traitConfidence[trait],
      }));
      expect(typeof stats.mean).toBe('number');
      expect(typeof stats.low).toBe('number');
      expect(typeof stats.high).toBe('number');
    }
    expect(scoreFile.models[0].traits.extroversion.confidence).toBe('low');
    expect(scoreFile.strategy_table.length).toBeGreaterThan(0);

    const broken = JSON.parse(JSON.stringify(scoreFile)) as { spread_warning?: boolean };
    delete broken.spread_warning;
    expect(() => validateScoreFile(broken)).toThrow(ScoreFileSchemaError);
    expect(() => validateScoreFile({ ...scoreFile, schema_version: 3 })).toThrow(/Delete the existing scores.json/);
    expect(scoreFile.strategy_table.filter((row) => row.trait === 'extroversion').every((row) => row.exclude_from_tiering && row.exclusion_reason)).toBe(true);
  });

  it('turns a wide openness gap into spread_warning false', () => {
    const config = loadConfig();
    const scoreFile = buildScoreFile({
      models: [model('openai/gpt-5-nano', 10), model('x-ai/grok-4.3', 90)],
      judge: { modelId: config.judge.modelId, version: 'judge-v', temperature: 0 },
      interviewTemperature: 0.8,
      repeats: 1,
      generatedAt: '2026-10-25T03:04:00.000Z',
      priceDate: config.priceDate,
      wideRangeThreshold: 40,
      spreadThreshold: 10,
      traitConfidence: config.traitConfidence,
    });
    expect(scoreFile.spread_warning).toBe(false);
    expect(scoreFile.trait_spread.openness).toBe(80);
  });

  it('derives the model wide_range flag from per-trait flags', () => {
    const config = loadConfig();
    const scoreFile = buildScoreFile({
      models: [{
        id: 'openai/gpt-5-nano',
        costUsd: 0,
        timestamp: '2026-10-25T03:00:00.000Z',
        repeats: [
          { repeat: 1, modelVersion: 'openai/gpt-5-nano', judgeVersion: 'judge-v', recordedAt: '2026-10-25T03:00:00.000Z', scores: neutralScores({ openness: 10 }) },
          { repeat: 2, modelVersion: 'openai/gpt-5-nano', judgeVersion: 'judge-v', recordedAt: '2026-10-25T03:01:00.000Z', scores: neutralScores({ openness: 80 }) },
        ],
      }],
      judge: { modelId: config.judge.modelId, version: 'judge-v', temperature: 0, recordedAt: '2026-10-25T03:04:00.000Z' },
      interviewTemperature: 0.8,
      repeats: 2,
      generatedAt: '2026-10-25T03:04:00.000Z',
      priceDate: config.priceDate,
      wideRangeThreshold: 40,
      spreadThreshold: 10,
      traitConfidence: config.traitConfidence,
    });
    expect(scoreFile.models[0].traits.openness.wide_range).toBe(true);
    expect(scoreFile.models[0].traits.conscientiousness.wide_range).toBe(false);
    expect(scoreFile.models[0].wide_range).toBe(true);
    expect(scoreFile.models[0].runs[1].recorded_at).toBe('2026-10-25T03:01:00.000Z');
  });
});
