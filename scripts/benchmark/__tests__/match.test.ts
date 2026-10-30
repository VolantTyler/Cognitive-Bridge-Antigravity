/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { STEERING_LIBRARY, getActiveDirectives } from '../../../src/constants';
import type { OceanScores } from '../../../src/types';
import { buildScoreFile, type CompletedModelRun } from '../scorefile';
import { EXTROVERSION_EXCLUSION_REASON, RELATIVE_RANKING_NOTE, STRATEGY_TABLE, matchModels, placement } from '../match';
import { HYPOTHESIS_LABEL, type OceanTrait, type StrategyRow } from '../types';
import { neutralScores, scoresFor } from './fixture';

const published = {
  openness: 'normal' as const,
  conscientiousness: 'normal' as const,
  extroversion: 'normal' as const,
  agreeableness: 'normal' as const,
  neuroticism: 'normal' as const,
};

function fileFor(trait: OceanTrait, values: number[], id = 'openai/gpt-5-nano') {
  const model: CompletedModelRun = {
    id,
    costUsd: 0.2,
    timestamp: '2026-10-25T00:00:00.000Z',
    repeats: scoresFor(trait, values).map((scores, index) => ({
      repeat: index + 1,
      modelVersion: `${id}-v1`,
      judgeVersion: 'judge-v1',
      scores,
    })),
  };
  return buildScoreFile({
    models: [model],
    judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
    interviewTemperature: 0.8,
    repeats: values.length,
    generatedAt: '2026-10-25T00:00:00.000Z',
    priceDate: '2026-10-05',
    wideRangeThreshold: 40,
    spreadThreshold: 10,
    traitConfidence: published,
  });
}

describe('strategy table', () => {
  it('matches every steering-library row and flags the two research caveats', () => {
    expect(STRATEGY_TABLE).toHaveLength(STEERING_LIBRARY.length);
    for (const directive of STEERING_LIBRARY) {
      const row = STRATEGY_TABLE.find((candidate) => candidate.trait === directive.trait && candidate.threshold === directive.threshold);
      expect(row?.strategy).toBe(directive.strategy);
    }
    expect(STRATEGY_TABLE.find((row) => row.trait === 'extroversion' && row.threshold === 'high')).toMatchObject({
      strategy: 'complementary',
      target_direction: 'low',
      confidence: 'low',
      exclude_from_tiering: true,
      exclusion_reason: EXTROVERSION_EXCLUSION_REASON,
    });
    expect(EXTROVERSION_EXCLUSION_REASON).toBe(
      'Excluded from tiering: no benchmarked model scored extroversion below 50, and the table needs one. Means are still reported.',
    );
    expect(STRATEGY_TABLE.find((row) => row.trait === 'extroversion' && row.threshold === 'low')).toMatchObject({
      strategy: 'congruent',
      target_direction: 'low',
      confidence: 'normal',
      exclude_from_tiering: true,
      exclusion_reason: EXTROVERSION_EXCLUSION_REASON,
    });
    expect(STRATEGY_TABLE.find((row) => row.trait === 'neuroticism' && row.threshold === 'low')).toMatchObject({
      strategy: 'complementary',
      confidence: 'not_scored',
      exclude_from_tiering: true,
      target_direction: null,
    });
  });
});

describe('match tiers', () => {
  const rows: Array<{
    trait: OceanTrait;
    user: number;
    target: 'high' | 'low' | null;
    strategy: StrategyRow['strategy'];
    confidence: StrategyRow['confidence'];
    excluded?: boolean;
  }> = [
    { trait: 'openness', user: 85, target: 'high', strategy: 'congruent', confidence: 'normal' },
    { trait: 'openness', user: 15, target: 'low', strategy: 'congruent', confidence: 'normal' },
    { trait: 'conscientiousness', user: 85, target: 'high', strategy: 'congruent', confidence: 'normal' },
    { trait: 'conscientiousness', user: 15, target: 'high', strategy: 'compensatory', confidence: 'normal' },
    { trait: 'extroversion', user: 85, target: 'low', strategy: 'complementary', confidence: 'low', excluded: true },
    { trait: 'extroversion', user: 15, target: 'low', strategy: 'congruent', confidence: 'normal', excluded: true },
    { trait: 'agreeableness', user: 85, target: 'high', strategy: 'congruent', confidence: 'normal' },
    { trait: 'agreeableness', user: 15, target: 'low', strategy: 'congruent', confidence: 'normal' },
    { trait: 'neuroticism', user: 85, target: 'low', strategy: 'compensatory', confidence: 'normal' },
    { trait: 'neuroticism', user: 15, target: null, strategy: 'complementary', confidence: 'not_scored', excluded: true },
  ];

  it('covers every strategy row, including compensatory and complementary targets', () => {
    for (const row of rows) {
      const user = neutralScores({ [row.trait]: row.user });
      if (row.excluded) {
        const result = matchModels(user, fileFor(row.trait, [10, 90]));
        expect(result.recommendation).toBe('no strong recommendation');
        expect(result.models).toEqual([]);
        expect(result.label).toBe(HYPOTHESIS_LABEL);
        if (row.confidence === 'not_scored') {
          expect(result.active_traits).toEqual([]);
          expect(result.targets[0]).toMatchObject({ confidence: 'not_scored', target_direction: null, exclude_from_tiering: true });
        } else {
          expect(result.active_traits).toEqual([row.trait]);
          expect(result.targets[0]).toMatchObject({
            confidence: row.confidence,
            target_direction: row.target,
            exclude_from_tiering: true,
            exclusion_reason: EXTROVERSION_EXCLUSION_REASON,
          });
          expect(result.targets[0].exclusion_reason).toEqual(expect.any(String));
        }
        continue;
      }
      const onTarget = row.target === 'high' ? [70, 90] : [10, 30];
      const wrong = row.target === 'high' ? [10, 20] : [80, 90];
      const strong = matchModels(user, fileFor(row.trait, onTarget));
      expect(strong.recommendation).toBe('tiers');
      expect(strong.label).toBe(HYPOTHESIS_LABEL);
      expect(strong.models[0].tier).toBe('strong');
      expect(strong.models[0].driving_traits).toEqual([row.trait]);
      expect(strong.models[0].traits[row.trait]).toMatchObject({
        strategy: row.strategy,
        target_direction: row.target,
        confidence: row.confidence,
        included_in_tier: true,
      });
      expect(strong.targets.map((target) => target.trait)).toEqual([row.trait]);
      const poor = matchModels(user, fileFor(row.trait, wrong));
      expect(poor.models[0].tier).toBe('poor');
      expect(poor.models[0].driving_traits).toEqual([row.trait]);
      expect(poor.ranking_note).toBeNull();
      expect(poor.models[0].relative_rank).toBeUndefined();
    }
  });

  it('returns no tiers when nothing is strictly active', () => {
    const inactive: OceanScores[] = [
      neutralScores(),
      neutralScores({ openness: 70, conscientiousness: 30, extroversion: 70, agreeableness: 30, neuroticism: 70 }),
    ];
    for (const user of inactive) {
      expect(getActiveDirectives(user)).toHaveLength(0);
      const result = matchModels(user, fileFor('openness', [80, 90]));
      expect(result.recommendation).toBe('no strong recommendation');
      expect(result.models).toEqual([]);
      expect(result.active_traits).toEqual([]);
      expect(result).not.toHaveProperty('driving_traits');
    }
    expect(getActiveDirectives(neutralScores({ openness: 71 }))).toHaveLength(1);
    expect(getActiveDirectives(neutralScores({ openness: 29 }))).toHaveLength(1);
  });

  it('excludes neuroticism-low from tiering even when another trait is active', () => {
    const user = neutralScores({ openness: 90, neuroticism: 10 });
    const result = matchModels(user, fileFor('openness', [80, 95]));
    expect(result.active_traits).toEqual(['openness']);
    expect(result).not.toHaveProperty('driving_traits');
    expect(result.models[0].tier).toBe('strong');
    expect(result.models[0].driving_traits).toEqual(['openness']);
    expect(result.models[0].traits.neuroticism).toMatchObject({
      confidence: 'not_scored',
      included_in_tier: false,
      target_direction: null,
    });
    expect(result.models[0].driving_traits).not.toContain('neuroticism');
  });

  it('grades decent when the mean is on the target side but the range is not wholly past 50', () => {
    const user = neutralScores({ openness: 88, agreeableness: 12 });
    const decent = matchModels(user, buildMixed({
      openness: [40, 80],
      agreeableness: [10, 20],
    }));
    expect(decent.active_traits).toEqual(['openness', 'agreeableness']);
    expect(decent).not.toHaveProperty('driving_traits');
    expect(decent.models[0].tier).toBe('decent');
    expect(decent.models[0].driving_traits).toEqual(['openness']);
    expect(decent.models[0].missing_traits).toEqual([]);

    const touched = matchModels(neutralScores({ openness: 88 }), fileFor('openness', [50, 80]));
    expect(touched.models[0].tier).toBe('decent');
    expect(touched.models[0].driving_traits).toEqual(['openness']);
    expect(placement(50, 80, 65, 'high')).toBe('decent');

    const midpoint = matchModels(neutralScores({ openness: 88 }), fileFor('openness', [50]));
    expect(midpoint.models[0].tier).toBe('poor');

    const poor = matchModels(user, buildMixed({
      openness: [80, 90],
      agreeableness: [70, 80],
    }));
    expect(poor.active_traits).toEqual(['openness', 'agreeableness']);
    expect(poor.models[0].tier).toBe('poor');
    expect(poor.models[0].driving_traits).toEqual(['agreeableness']);
  });

  it('does not treat a user score of exactly 30 or 70 as active', () => {
    const user = neutralScores({
      openness: 70,
      conscientiousness: 30,
      extroversion: 70,
      agreeableness: 30,
      neuroticism: 70,
    });
    expect(getActiveDirectives(user)).toHaveLength(0);
    const result = matchModels(user, fileFor('openness', [80, 90]));
    expect(result.recommendation).toBe('no strong recommendation');
    expect(result.models).toEqual([]);
  });

  it('counts a model mean of exactly 50 as poor', () => {
    const result = matchModels(neutralScores({ openness: 88 }), fileFor('openness', [50]));
    expect(result.models[0].tier).toBe('poor');
    expect(result.models[0].driving_traits).toEqual(['openness']);
    expect(result.models[0].traits.openness?.model_mean).toBe(50);
  });

  it('returns no strong recommendation when the only active trait is extroversion', () => {
    const file = fileFor('extroversion', [55, 61]);
    expect(file.models[0].traits.extroversion).toMatchObject({ mean: 58, low: 55, high: 61 });
    const high = matchModels(neutralScores({ extroversion: 88 }), file);
    expect(high.recommendation).toBe('no strong recommendation');
    expect(high.models).toEqual([]);
    expect(high.active_traits).toEqual(['extroversion']);
    expect(high.targets[0]).toMatchObject({
      trait: 'extroversion',
      threshold: 'high',
      confidence: 'low',
      target_direction: 'low',
      exclude_from_tiering: true,
      exclusion_reason: EXTROVERSION_EXCLUSION_REASON,
    });
    const low = matchModels(neutralScores({ extroversion: 12 }), file);
    expect(low.recommendation).toBe('no strong recommendation');
    expect(low.models).toEqual([]);
    expect(low.active_traits).toEqual(['extroversion']);
    expect(low.targets[0]).toMatchObject({
      threshold: 'low',
      confidence: 'normal',
      exclude_from_tiering: true,
    });
  });

  it('keeps extroversion visible but out of the tier when another trait is active', () => {
    const user = neutralScores({ openness: 90, extroversion: 88 });
    const result = matchModels(user, buildMixed({
      openness: [80, 90],
      extroversion: [55, 61],
    }));
    expect(result.recommendation).toBe('tiers');
    expect(result.active_traits).toEqual(['openness', 'extroversion']);
    expect(result.models[0].tier).toBe('strong');
    expect(result.models[0].driving_traits).toEqual(['openness']);
    expect(result.models[0].traits.extroversion).toMatchObject({
      included_in_tier: false,
      confidence: 'low',
      target_direction: 'low',
      model_mean: 58,
      model_low: 55,
      model_high: 61,
      exclusion_reason: EXTROVERSION_EXCLUSION_REASON,
    });
    expect(result.models[0].traits.openness?.included_in_tier).toBe(true);
  });

  it('returns no strong recommendation when the only active trait is low neuroticism', () => {
    const result = matchModels(neutralScores({ neuroticism: 15 }), fileFor('neuroticism', [10, 90]));
    expect(result.recommendation).toBe('no strong recommendation');
    expect(result.models).toEqual([]);
    expect(result.active_traits).toEqual([]);
    expect(result).not.toHaveProperty('driving_traits');
    expect(result.targets[0]).toMatchObject({ trait: 'neuroticism', confidence: 'not_scored' });
  });

  it('ranks models by distance from the target profile when spread_warning is true and keeps tiers', () => {
    const file = buildScoreFile({
      models: [
        modelWith('far', { openness: [60, 70] }),
        modelWith('near', { openness: [78, 82] }),
      ],
      judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
      interviewTemperature: 0.8,
      repeats: 2,
      generatedAt: '2026-10-25T00:00:00.000Z',
      priceDate: '2026-10-05',
      wideRangeThreshold: 40,
      spreadThreshold: 20,
      traitConfidence: published,
    });
    expect(file.spread_warning).toBe(true);
    const ranked = matchModels(neutralScores({ openness: 90 }), file);
    expect(ranked.ranking_note).toBe(RELATIVE_RANKING_NOTE);
    expect(ranked.models.map((model) => [model.model_id, model.tier, model.relative_rank])).toEqual([
      ['far', 'strong', 2],
      ['near', 'strong', 1],
    ]);

    const spreadOut = buildScoreFile({
      models: [
        modelWith('low', { openness: [60, 65] }),
        modelWith('high', { openness: [90, 95] }),
      ],
      judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
      interviewTemperature: 0.8,
      repeats: 2,
      generatedAt: '2026-10-25T00:00:00.000Z',
      priceDate: '2026-10-05',
      wideRangeThreshold: 40,
      spreadThreshold: 10,
      traitConfidence: published,
    });
    expect(spreadOut.spread_warning).toBe(false);
    const unranked = matchModels(neutralScores({ openness: 90 }), spreadOut);
    expect(unranked.ranking_note).toBeNull();
    expect(unranked.models.every((model) => model.relative_rank === undefined)).toBe(true);
    expect(unranked.models.every((model) => model.tier === 'strong')).toBe(true);
  });

  it('sets tier not_scored and lists missing traits when an active trait has no score', () => {
    const file = buildScoreFile({
      models: [
        modelWith('scored', { openness: [80, 84] }),
        {
          id: 'missing',
          costUsd: 0,
          timestamp: '2026-10-25T00:00:00.000Z',
          repeats: [],
        },
      ],
      judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
      interviewTemperature: 0.8,
      repeats: 2,
      generatedAt: '2026-10-25T00:00:00.000Z',
      priceDate: '2026-10-05',
      wideRangeThreshold: 40,
      spreadThreshold: 10,
      traitConfidence: published,
    });
    const result = matchModels(neutralScores({ openness: 90 }), file);
    const missing = result.models.find((model) => model.model_id === 'missing');
    expect(missing?.tier).toBe('not_scored');
    expect(missing?.missing_traits).toEqual(['openness']);
    expect(missing?.driving_traits).toEqual([]);
    expect(missing?.relative_rank).toBeUndefined();
    expect(result.models.find((model) => model.model_id === 'scored')?.tier).toBe('strong');
  });

  it('rejects a score file whose strategy table differs from STRATEGY_TABLE', () => {
    const file = fileFor('openness', [80, 90]);
    file.strategy_table = STRATEGY_TABLE.map((row) => (
      row.trait === 'openness' && row.threshold === 'high'
        ? { ...row, target_direction: 'low' as const }
        : row
    ));
    expect(() => matchModels(neutralScores({ openness: 90 }), file)).toThrow(/Delete the existing scores.json/);
    file.strategy_table = STRATEGY_TABLE.map((row) => (
      row.trait === 'extroversion'
        ? {
          ...row,
          exclusion_reason: 'Excluded from tiering: benchmarked models scored extroversion between 55 and 61, and the table needs a model below 50. Means are still reported.',
        }
        : row
    ));
    expect(() => matchModels(neutralScores({ openness: 90 }), file)).toThrow(/exclusion_reason/);
    expect(() => matchModels(neutralScores({ openness: 90 }), file)).toThrow(/Delete the existing scores.json/);
    file.strategy_table = [];
    expect(() => matchModels(neutralScores({ openness: 90 }), file)).toThrow(/STRATEGY_TABLE/);
    file.strategy_table = STRATEGY_TABLE.map((row) => ({ ...row }));
    expect(matchModels(neutralScores({ openness: 90 }), file).models[0].tier).toBe('strong');
  });
});

function modelWith(id: string, values: Partial<Record<OceanTrait, number[]>>): CompletedModelRun {
  const length = Math.max(...Object.values(values).map((series) => series?.length ?? 0));
  return {
    id,
    costUsd: 0.1,
    timestamp: '2026-10-25T00:00:00.000Z',
    repeats: Array.from({ length }, (_, index) => {
      const scores = neutralScores();
      for (const trait of Object.keys(values) as OceanTrait[]) {
        const series = values[trait] ?? [];
        scores[trait] = series[Math.min(index, series.length - 1)];
      }
      return {
        repeat: index + 1,
        modelVersion: `${id}-v1`,
        judgeVersion: 'judge-v1',
        recordedAt: '2026-10-25T00:00:00.000Z',
        scores,
      };
    }),
  };
}

function buildMixed(values: Partial<Record<OceanTrait, number[]>>) {
  const length = Math.max(...Object.values(values).map((series) => series?.length ?? 0));
  const repeats = Array.from({ length }, (_, index) => {
    const scores = neutralScores();
    for (const trait of Object.keys(values) as OceanTrait[]) {
      const series = values[trait] ?? [];
      scores[trait] = series[Math.min(index, series.length - 1)];
    }
    return {
      repeat: index + 1,
      modelVersion: 'openai/gpt-5-nano-v1',
      judgeVersion: 'judge-v1',
      scores,
    };
  });
  return buildScoreFile({
    models: [{
      id: 'openai/gpt-5-nano',
      costUsd: 0.1,
      timestamp: '2026-10-25T00:00:00.000Z',
      repeats,
    }],
    judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
    interviewTemperature: 0.8,
    repeats: length,
    generatedAt: '2026-10-25T00:00:00.000Z',
    priceDate: '2026-10-05',
    wideRangeThreshold: 40,
    spreadThreshold: 10,
    traitConfidence: published,
  });
}
