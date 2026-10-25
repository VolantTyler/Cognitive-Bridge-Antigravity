/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OceanScores } from '../../src/types';
import {
  OCEAN_TRAITS,
  type Confidence,
  type OceanTrait,
  type TraitStats,
} from './types';

export function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error('mean requires at least one value');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateTrait(
  values: number[],
  publishedConfidence: Confidence,
): TraitStats {
  if (values.length === 0) {
    return { mean: null, low: null, high: null, runs: 0, confidence: 'not_scored' };
  }
  return {
    mean: mean(values),
    low: Math.min(...values),
    high: Math.max(...values),
    runs: values.length,
    confidence: publishedConfidence,
  };
}

export function aggregateTraits(
  runs: OceanScores[],
  published: Record<OceanTrait, Confidence>,
): Record<OceanTrait, TraitStats> {
  const traits = {} as Record<OceanTrait, TraitStats>;
  for (const trait of OCEAN_TRAITS) {
    traits[trait] = aggregateTrait(
      runs.map((scores) => scores[trait]),
      published[trait],
    );
  }
  return traits;
}

export function hasWideRange(
  traits: Record<OceanTrait, TraitStats>,
  threshold: number,
): boolean {
  return OCEAN_TRAITS.some((trait) => {
    const stats = traits[trait];
    return stats.low !== null && stats.high !== null && stats.high - stats.low >= threshold;
  });
}

export function traitSpreads(
  modelTraits: Array<Record<OceanTrait, TraitStats>>,
): Record<OceanTrait, number | null> {
  const spreads = {} as Record<OceanTrait, number | null>;
  for (const trait of OCEAN_TRAITS) {
    const means = modelTraits
      .map((traits) => traits[trait].mean)
      .filter((value): value is number => value !== null);
    // One model is not a cluster. Leave the spread unknown until two means exist.
    spreads[trait] = means.length >= 2 ? Math.max(...means) - Math.min(...means) : null;
  }
  return spreads;
}

/**
 * True when every trait has at least two model means and each across-model
 * spread is under the threshold, so a UI can rank models against each other.
 */
export function spreadWarning(
  spreads: Record<OceanTrait, number | null>,
  threshold: number,
): boolean {
  const scored = OCEAN_TRAITS.map((trait) => spreads[trait]);
  if (scored.some((spread) => spread === null)) return false;
  return scored.every((spread) => (spread as number) < threshold);
}
