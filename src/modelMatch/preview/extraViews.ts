/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preview-only views. Not imported by the app.
 */

import { RELATIVE_RANKING_NOTE } from '../../../scripts/benchmark/match';
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

export function relativeRankView(): ModelMatchView {
  const file = structuredClone(realScoreFile) as ScoreFile;
  file.spread_warning = true;
  file.run_label = 'original four';
  return buildView(opennessMatch([
    {
      model_id: 'x-ai/grok-4.3',
      tier: 'strong',
      driving_traits: ['openness'],
      missing_traits: [],
      relative_rank: 2,
      traits: { openness: { ...opennessTrait, model_mean: 78, model_low: 70, model_high: 88 } },
    },
    {
      model_id: 'anthropic/claude-haiku-4.5',
      tier: 'decent',
      driving_traits: ['openness'],
      missing_traits: [],
      relative_rank: 1,
      traits: { openness: { ...opennessTrait, model_mean: 70, model_low: 40, model_high: 90 } },
    },
  ], RELATIVE_RANKING_NOTE), file);
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
