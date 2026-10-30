/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One match function. Replace STRATEGY_TABLE in this file to swap the hypothesis.
 * A score file whose stored table differs is rejected. Active traits follow
 * getActiveDirectives (strictly >70 or <30). Tiers are fit bands against 50.
 * When the score file's spread_warning is true, models are also ranked by
 * distance from the target profile.
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
} from './types';

export const EXTROVERSION_EXCLUSION_REASON = 'Excluded from tiering: no benchmarked model scored extroversion below 50, and the table needs one. Means are still reported.';

const counted = { exclude_from_tiering: false, exclusion_reason: null } as const;

export const STRATEGY_TABLE: StrategyRow[] = [
  { trait: 'openness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', ...counted },
  { trait: 'openness', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', ...counted },
  { trait: 'conscientiousness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', ...counted },
  { trait: 'conscientiousness', threshold: 'low', strategy: 'compensatory', target_direction: 'high', confidence: 'normal', ...counted },
  { trait: 'extroversion', threshold: 'high', strategy: 'complementary', target_direction: 'low', confidence: 'low', exclude_from_tiering: true, exclusion_reason: EXTROVERSION_EXCLUSION_REASON },
  { trait: 'extroversion', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', exclude_from_tiering: true, exclusion_reason: EXTROVERSION_EXCLUSION_REASON },
  { trait: 'agreeableness', threshold: 'high', strategy: 'congruent', target_direction: 'high', confidence: 'normal', ...counted },
  { trait: 'agreeableness', threshold: 'low', strategy: 'congruent', target_direction: 'low', confidence: 'normal', ...counted },
  { trait: 'neuroticism', threshold: 'high', strategy: 'compensatory', target_direction: 'low', confidence: 'normal', ...counted },
  { trait: 'neuroticism', threshold: 'low', strategy: 'complementary', target_direction: null, confidence: 'not_scored', exclude_from_tiering: true, exclusion_reason: null },
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
): 'strong' | 'decent' | 'poor' {
  const meanOnTarget = target === 'high' ? mean > 50 : mean < 50;
  const rangeOnTarget = target === 'high' ? low > 50 && high > 50 : low < 50 && high < 50;
  if (!meanOnTarget) return 'poor';
  if (rangeOnTarget) return 'strong';
  return 'decent';
}

function combinePlacements(placements: Array<'strong' | 'decent' | 'poor'>): 'strong' | 'decent' | 'poor' {
  if (placements.some((item) => item === 'poor')) return 'poor';
  if (placements.every((item) => item === 'strong')) return 'strong';
  return 'decent';
}

export const RELATIVE_RANKING_NOTE = 'Ranking is relative because models cluster';

/** High targets sit at 100 and low targets at 0, so a tight cluster can still be ordered. */
export function targetProfilePoint(direction: TargetDirection): number {
  return direction === 'high' ? 100 : 0;
}

export function distanceFromTarget(points: Array<{ mean: number; target: TargetDirection }>): number {
  let sum = 0;
  for (const point of points) {
    const delta = point.mean - targetProfilePoint(point.target);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function sameStrategyRow(stored: StrategyRow, expected: StrategyRow): boolean {
  return stored.trait === expected.trait
    && stored.threshold === expected.threshold
    && stored.strategy === expected.strategy
    && stored.target_direction === expected.target_direction
    && stored.confidence === expected.confidence
    && stored.exclude_from_tiering === expected.exclude_from_tiering
    && stored.exclusion_reason === expected.exclusion_reason;
}

export function assertStoredStrategyTable(stored: StrategyRow[] | undefined): void {
  if (stored === undefined) return;
  const matches = stored.length === STRATEGY_TABLE.length
    && stored.every((row, index) => sameStrategyRow(row, STRATEGY_TABLE[index]));
  if (!matches) {
    throw new Error(
      'Score file strategy_table does not match the in-code STRATEGY_TABLE, including a changed exclusion_reason. A score file written with the previous extroversion exclusion wording fails this check. Refusing to match against a different hypothesis. Delete the existing scores.json and re-run the benchmark. This run does not merge an older score file.',
    );
  }
}

interface ScoredTrait {
  trait: OceanTrait;
  placement: 'strong' | 'decent' | 'poor';
  mean: number;
  target: TargetDirection;
}

function traitsThatSetTier(tier: 'strong' | 'decent' | 'poor', scored: ScoredTrait[]): OceanTrait[] {
  if (tier === 'strong') {
    return scored.filter((item) => item.placement === 'strong').map((item) => item.trait);
  }
  if (tier === 'decent') {
    return scored.filter((item) => item.placement === 'decent').map((item) => item.trait);
  }
  return scored.filter((item) => item.placement === 'poor').map((item) => item.trait);
}

export function matchModels(userScores: OceanScores, scoreFile: ScoreFile): MatchResult {
  assertStoredStrategyTable(scoreFile.strategy_table);
  const table = STRATEGY_TABLE;
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
  const eligible = applied.filter((row) => row.confidence !== 'not_scored' && !row.exclude_from_tiering);
  const eligibleTraits = eligible.map((row) => row.trait);
  const activeTraits = applied.filter((row) => row.confidence !== 'not_scored').map((row) => row.trait);

  if (eligibleTraits.length === 0) {
    return {
      label: HYPOTHESIS_LABEL,
      recommendation: 'no strong recommendation',
      targets: applied,
      strategy_table: table,
      active_traits: activeTraits,
      ranking_note: null,
      models: [],
    };
  }

  const distances = new Map<string, number>();
  const models: MatchModelResult[] = scoreFile.models.map((model) => {
    const traits: MatchModelResult['traits'] = {};
    const scored: ScoredTrait[] = [];
    const missingTraits: OceanTrait[] = [];
    for (const row of applied) {
      const stats = model.traits[row.trait as OceanTrait];
      const included = row.confidence !== 'not_scored' && !row.exclude_from_tiering;
      traits[row.trait] = {
        strategy: row.strategy,
        target_direction: row.target_direction,
        confidence: row.confidence,
        included_in_tier: included,
        exclusion_reason: included ? null : row.exclusion_reason,
        user_score: row.user_score,
        model_mean: stats?.mean ?? null,
        model_low: stats?.low ?? null,
        model_high: stats?.high ?? null,
      } satisfies MatchTraitResult;
      if (!included) continue;
      if (
        stats == null ||
        stats.mean === null ||
        stats.low === null ||
        stats.high === null ||
        stats.confidence === 'not_scored' ||
        row.target_direction === null
      ) {
        missingTraits.push(row.trait);
        continue;
      }
      scored.push({
        trait: row.trait,
        placement: placement(stats.low, stats.high, stats.mean, row.target_direction),
        mean: stats.mean,
        target: row.target_direction,
      });
    }
    if (model.not_scored_reason) {
      return {
        model_id: model.id,
        tier: 'not_scored' as const,
        driving_traits: [],
        missing_traits: eligibleTraits,
        not_scored_reason: model.not_scored_reason,
        traits,
      };
    }
    if (missingTraits.length > 0) {
      return {
        model_id: model.id,
        tier: 'not_scored' as const,
        driving_traits: [],
        missing_traits: missingTraits,
        traits,
      };
    }
    const tier = combinePlacements(scored.map((item) => item.placement));
    distances.set(
      model.id,
      distanceFromTarget(scored.map((item) => ({ mean: item.mean, target: item.target }))),
    );
    return {
      model_id: model.id,
      tier,
      driving_traits: traitsThatSetTier(tier, scored),
      missing_traits: [],
      traits,
    };
  });

  const rankById = new Map<string, number>();
  if (scoreFile.spread_warning) {
    const ordered = [...distances.entries()].sort(
      (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
    );
    ordered.forEach(([modelId], index) => rankById.set(modelId, index + 1));
  }

  const rankedModels: MatchModelResult[] = models.map((model) => {
    const relativeRank = rankById.get(model.model_id);
    if (relativeRank === undefined) return model;
    return { ...model, relative_rank: relativeRank };
  });

  return {
    label: HYPOTHESIS_LABEL,
    recommendation: 'tiers',
    targets: applied,
    strategy_table: table,
    active_traits: activeTraits,
    ranking_note: rankById.size > 0 ? RELATIVE_RANKING_NOTE : null,
    models: rankedModels,
  };
}
