/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One swappable match: pass `table` or replace STRATEGY_TABLE.
 * Charlie's design hypothesis — not a validated ranking. Active traits follow
 * getActiveDirectives (strictly >70 or <30). Tiers are fit bands against 50.
 */

import { getActiveDirectives } from '../../src/constants';
import type { OceanScores } from '../../src/types';
import {
  HYPOTHESIS_LABEL,
  type AppliedTarget,
  type MatchModelResult,
  type MatchResult,
  type MatchTraitResult,
  type OceanTrait,
  type ScoreFile,
  type StrategyRow,
  type TargetDirection,
  type Tier,
} from './types';

export const STRATEGY_TABLE: StrategyRow[] = [
  { trait: 'openness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'openness', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'conscientiousness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'conscientiousness', threshold: 'low', strategy: 'compensatory', target_direction: 'high', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'extroversion', threshold: 'high', strategy: 'complementary', target_direction: 'low', confidence: 'low', exclude_from_tiering: false },
  { trait: 'extroversion', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'agreeableness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'agreeableness', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'neuroticism', threshold: 'high', strategy: 'compensatory', target_direction: 'low', confidence: 'normal', exclude_from_tiering: false },
  { trait: 'neuroticism', threshold: 'low', strategy: 'complementary', target_direction: null, confidence: 'not_scored', exclude_from_tiering: true },
];

export function assertStrategyTable(table: StrategyRow[]): void {
  for (const row of table) {
    if (row.confidence === 'not_scored') {
      if (!row.exclude_from_tiering || row.target_direction !== null) {
        throw new Error(`${row.trait} ${row.threshold} is not_scored and must be excluded from tiering with no target`);
      }
    } else if (row.target_direction === null) {
      throw new Error(`${row.trait} ${row.threshold} needs a target direction`);
    }
  }
}

export function placement(
  low: number,
  high: number,
  mean: number,
  target: TargetDirection,
): Tier {
  const meanOnTarget = target === 'high' ? mean > 50 : mean < 50;
  const rangeOnTarget = target === 'high' ? low > 50 && high > 50 : low < 50 && high < 50;
  if (!meanOnTarget) return 'poor';
  if (rangeOnTarget) return 'strong';
  return 'decent';
}

function combinePlacements(placements: Tier[]): Tier {
  if (placements.some((item) => item === 'poor')) return 'poor';
  if (placements.every((item) => item === 'strong')) return 'strong';
  return 'decent';
}

export function matchModels(
  userScores: OceanScores,
  scoreFile: ScoreFile,
  table: StrategyRow[] = scoreFile.strategy_table?.length ? scoreFile.strategy_table : STRATEGY_TABLE,
): MatchResult {
  assertStrategyTable(table);
  const active = getActiveDirectives(userScores);
  const applied: AppliedTarget[] = active.map((directive) => {
    const row = table.find(
      (candidate) => candidate.trait === directive.trait && candidate.threshold === directive.threshold,
    );
    if (!row) {
      throw new Error(`Strategy table has no row for ${directive.trait} ${directive.threshold}`);
    }
    return { ...row, user_score: userScores[directive.trait] };
  });
  const driving = applied.filter((row) => row.confidence !== 'not_scored' && !row.exclude_from_tiering);
  const drivingTraits = driving.map((row) => row.trait);

  if (drivingTraits.length === 0) {
    return {
      label: HYPOTHESIS_LABEL,
      recommendation: 'no strong recommendation',
      targets: applied,
      strategy_table: table,
      driving_traits: [],
      models: [],
    };
  }

  const models: MatchModelResult[] = scoreFile.models.map((model) => {
    const traits: MatchModelResult['traits'] = {};
    const placements: Tier[] = [];
    let missing = false;
    for (const row of applied) {
      const stats = model.traits[row.trait as OceanTrait];
      const result: MatchTraitResult = {
        strategy: row.strategy,
        target_direction: row.target_direction,
        confidence: row.confidence,
        included_in_tier: row.confidence !== 'not_scored' && !row.exclude_from_tiering,
        user_score: row.user_score,
        model_mean: stats?.mean ?? null,
        model_low: stats?.low ?? null,
        model_high: stats?.high ?? null,
      };
      traits[row.trait] = result;
      if (!result.included_in_tier) continue;
      if (
        stats == null ||
        stats.mean === null ||
        stats.low === null ||
        stats.high === null ||
        stats.confidence === 'not_scored' ||
        row.target_direction === null
      ) {
        missing = true;
        continue;
      }
      placements.push(placement(stats.low, stats.high, stats.mean, row.target_direction));
    }
    const modelResult: MatchModelResult = {
      model_id: model.id,
      driving_traits: drivingTraits,
      traits,
    };
    if (!missing && placements.length === drivingTraits.length) {
      modelResult.tier = combinePlacements(placements);
    }
    return modelResult;
  });

  return {
    label: HYPOTHESIS_LABEL,
    recommendation: 'tiers',
    targets: applied,
    strategy_table: table,
    driving_traits: drivingTraits,
    models,
  };
}
