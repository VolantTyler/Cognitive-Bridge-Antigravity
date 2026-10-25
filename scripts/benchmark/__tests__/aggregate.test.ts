/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { aggregateTrait, aggregateTraits, hasWideRange, spreadWarning, traitSpreads } from '../aggregate';
import { neutralScores } from './fixture';
import type { TraitStats } from '../types';
import { OCEAN_TRAITS } from '../types';

describe('aggregation', () => {
  it('stores mean, low, high, and run count', () => {
    const stats = aggregateTrait([10, 20, 30, 40, 100], 'normal');
    expect(stats).toEqual({ mean: 40, low: 10, high: 100, runs: 5, confidence: 'normal' });
  });

  it('flags a wide low-high range and leaves an empty trait not_scored', () => {
    const traits = aggregateTraits(
      [neutralScores({ openness: 10 }), neutralScores({ openness: 80 })],
      {
        openness: 'normal',
        conscientiousness: 'normal',
        extroversion: 'low',
        agreeableness: 'normal',
        neuroticism: 'normal',
      },
    );
    expect(traits.openness).toMatchObject({ mean: 45, low: 10, high: 80, runs: 2, confidence: 'normal' });
    expect(traits.extroversion.confidence).toBe('low');
    expect(hasWideRange(traits, 40)).toBe(true);
    expect(hasWideRange(traits, 80)).toBe(false);
    expect(aggregateTrait([], 'normal')).toEqual({
      mean: null,
      low: null,
      high: null,
      runs: 0,
      confidence: 'not_scored',
    });
  });

  it('sets spread_warning only when every trait clusters under the threshold', () => {
    const tight = traitBlock(50, 55);
    const wide = traitBlock(50, 80);
    expect(spreadWarning(traitSpreads([tight, tight]), 10)).toBe(true);
    expect(spreadWarning(traitSpreads([tight, wide]), 10)).toBe(false);
    expect(spreadWarning(traitSpreads([tight]), 10)).toBe(false);
  });
});

function traitBlock(lowMean: number, highMean: number): Record<(typeof OCEAN_TRAITS)[number], TraitStats> {
  const traits = {} as Record<(typeof OCEAN_TRAITS)[number], TraitStats>;
  for (const trait of OCEAN_TRAITS) {
    const mean = trait === 'openness' ? highMean : lowMean;
    traits[trait] = { mean, low: mean, high: mean, runs: 1, confidence: 'normal' };
  }
  return traits;
}
