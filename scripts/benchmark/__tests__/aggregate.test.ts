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
    const stats = aggregateTrait([10, 20, 30, 40, 100], 'normal', 40);
    expect(stats).toEqual({
      mean: 40,
      low: 10,
      high: 100,
      runs: 5,
      confidence: 'normal',
      wide_range: true,
    });
  });

  it('flags a wide range per trait and derives the model flag from those flags', () => {
    const traits = aggregateTraits(
      [neutralScores({ openness: 10 }), neutralScores({ openness: 80 })],
      {
        openness: 'normal',
        conscientiousness: 'normal',
        extroversion: 'low',
        agreeableness: 'normal',
        neuroticism: 'normal',
      },
      40,
    );
    expect(traits.openness).toMatchObject({ mean: 45, low: 10, high: 80, runs: 2, confidence: 'normal', wide_range: true });
    expect(traits.conscientiousness.wide_range).toBe(false);
    expect(traits.extroversion.confidence).toBe('low');
    expect(traits.extroversion.wide_range).toBe(false);
    expect(hasWideRange(traits)).toBe(true);
    const tight = aggregateTraits(
      [neutralScores({ openness: 40 }), neutralScores({ openness: 70 })],
      {
        openness: 'normal',
        conscientiousness: 'normal',
        extroversion: 'normal',
        agreeableness: 'normal',
        neuroticism: 'normal',
      },
      40,
    );
    expect(tight.openness.wide_range).toBe(false);
    expect(hasWideRange(tight)).toBe(false);
    expect(aggregateTrait([], 'normal', 40)).toEqual({
      mean: null,
      low: null,
      high: null,
      runs: 0,
      confidence: 'not_scored',
      wide_range: false,
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
    traits[trait] = { mean, low: mean, high: mean, runs: 1, confidence: 'normal', wide_range: false };
  }
  return traits;
}
