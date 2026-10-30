/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preview-only views. Not imported by the app.
 */

import { matchModels } from '../../../scripts/benchmark/match';
import { buildScoreFile } from '../../../scripts/benchmark/scorefile';
import { HYPOTHESIS_LABEL, type MatchResult, type ScoreFile } from '../../../scripts/benchmark/types';
import { realScoreFile } from '../__fixtures__/joinSamples';
import { buildView, type ModelMatchView } from '../derive';

function opennessMatch(models: MatchResult['models'], rankingNote: string | null): MatchResult {
  return {
    label: HYPOTHESIS_LABEL,
    recommendation: 'tiers',
    targets: [{
      trait: 'openness',
      threshold: 'high',
      strategy: 'congruent',
      target_direction: 'high',
      confidence: 'normal',
      exclude_from_tiering: false,
      exclusion_reason: null,
      user_score: 90,
    }],
    strategy_table: [],
    active_traits: ['openness'],
    ranking_note: rankingNote,
    models,
  };
}

const opennessTrait = {
  strategy: 'congruent' as const,
  target_direction: 'high' as const,
  confidence: 'normal' as const,
  included_in_tier: true,
  exclusion_reason: null,
  user_score: 90,
  model_mean: 80,
  model_low: 70,
  model_high: 90,
};

export function lowConfidenceView(): ModelMatchView {
  const file = structuredClone(realScoreFile) as ScoreFile;
  file.models = [{
    ...file.models[0],
    id: 'openai/gpt-5-nano',
    traits: {
      ...file.models[0].traits,
      openness: { ...file.models[0].traits.openness, confidence: 'low', wide_range: false, mean: 80, low: 70, high: 90 },
    },
  }];
  return buildView(opennessMatch([{
    model_id: 'openai/gpt-5-nano',
    tier: 'strong',
    driving_traits: ['openness'],
    missing_traits: [],
    traits: { openness: opennessTrait },
  }], null), file);
}

/**
 * Real matchModels output, not the 10-repeat file. A strong model sits just
 * past 50. A decent model has a higher mean but a range that crosses 50, so
 * it is closer to a high target and receives the better global rank.
 * Means stay within the spread threshold, so spread_warning is true.
 */
export function relativeRankView(): ModelMatchView {
  const neutral = {
    openness: 50,
    conscientiousness: 50,
    extroversion: 50,
    agreeableness: 50,
    neuroticism: 50,
  };
  const model = (id: string, openness: number[]) => ({
    id,
    costUsd: 0.1,
    timestamp: '2026-11-01T00:00:00.000Z',
    repeats: openness.map((value, index) => ({
      repeat: index + 1,
      modelVersion: id,
      judgeVersion: 'judge-v1',
      scores: { ...neutral, openness: value },
    })),
  });
  const file = buildScoreFile({
    models: [
      model('lab/strong-just-past-50', [58, 60, 62]),
      model('lab/decent-closer-to-target', [45, 72, 75]),
    ],
    judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
    interviewTemperature: 0,
    repeats: 3,
    generatedAt: '2026-11-01T00:00:00.000Z',
    priceDate: '2026-10-05',
    wideRangeThreshold: 40,
    spreadThreshold: 10,
    traitConfidence: {
      openness: 'normal',
      conscientiousness: 'normal',
      extroversion: 'normal',
      agreeableness: 'normal',
      neuroticism: 'normal',
    },
    runLabel: 'rank example',
  });
  const result = matchModels({ ...neutral, openness: 90 }, file);
  return buildView(result, file);
}

export function balancedView(): ModelMatchView {
  const match: MatchResult = {
    label: HYPOTHESIS_LABEL,
    recommendation: 'no strong recommendation',
    targets: [],
    strategy_table: [],
    active_traits: [],
    ranking_note: null,
    models: [],
  };
  return buildView(match, realScoreFile);
}
