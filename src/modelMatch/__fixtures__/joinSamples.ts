/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test and screenshot preview only. The app does not import this module.
 * match-samples holds matchModels output. The 10-repeat file supplies
 * run counts, ranges, and timestamps. matchModels rejects that file.
 */

import { placement } from '../../../scripts/benchmark/match';
import {
  HYPOTHESIS_LABEL,
  type MatchModelResult,
  type MatchResult,
  type ScoreFile,
} from '../../../scripts/benchmark/types';
import type { OceanScores } from '../../types';
import { buildView, type ModelMatchView } from '../derive';
import samplesJson from './match-samples.json';
import scoreFileJson from './scores-10run-2026-10-29.json';

export type SampleKey = 'A' | 'B' | 'C' | 'D' | 'E';

interface SampleEntry {
  profile: OceanScores;
  result: MatchResult;
}

const samples = samplesJson as unknown as Record<SampleKey, SampleEntry>;

export const realScoreFile = scoreFileJson as unknown as ScoreFile;

export function sampleEntry(key: SampleKey): SampleEntry {
  return samples[key];
}

export function sampleView(key: SampleKey): ModelMatchView {
  return buildView(samples[key].result, realScoreFile);
}

/**
 * Agreeableness-only tiers from the real file's trait stats.
 * placement() does not check strategy_table, so this still works while
 * matchModels rejects the file.
 */
export function agreeablenessTieView(): ModelMatchView {
  const models: MatchModelResult[] = realScoreFile.models.map((model) => {
    const stats = model.traits.agreeableness;
    const traits = {
      agreeableness: {
        strategy: 'congruent' as const,
        target_direction: 'high' as const,
        confidence: 'normal' as const,
        included_in_tier: true,
        exclusion_reason: null,
        user_score: 90,
        model_mean: stats.mean,
        model_low: stats.low,
        model_high: stats.high,
      },
    };
    if (model.not_scored_reason) {
      return {
        model_id: model.id,
        tier: 'not_scored' as const,
        driving_traits: [],
        missing_traits: ['agreeableness' as const],
        not_scored_reason: model.not_scored_reason,
        traits,
      };
    }
    const tier = placement(stats.low ?? 0, stats.high ?? 0, stats.mean ?? 0, 'high');
    return {
      model_id: model.id,
      tier,
      driving_traits: ['agreeableness' as const],
      missing_traits: [],
      traits,
    };
  });
  const match: MatchResult = {
    label: HYPOTHESIS_LABEL,
    recommendation: 'tiers',
    targets: [{
      trait: 'agreeableness',
      threshold: 'high',
      strategy: 'congruent',
      target_direction: 'high',
      confidence: 'normal',
      exclude_from_tiering: false,
      exclusion_reason: null,
      user_score: 90,
    }],
    strategy_table: realScoreFile.strategy_table,
    active_traits: ['agreeableness'],
    ranking_note: null,
    models,
  };
  return buildView(match, realScoreFile);
}
