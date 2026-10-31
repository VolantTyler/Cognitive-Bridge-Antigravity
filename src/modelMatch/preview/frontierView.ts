/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Screenshot preview only. The frontier JSON files are fixtures, not the shipped run.
 */

import { matchModels } from '../../../scripts/benchmark/match';
import type { ScoreFile } from '../../../scripts/benchmark/types';
import type { OceanScores } from '../../types';
import frontierAJson from '../__fixtures__/scores-frontier-a.json';
import frontierBJson from '../__fixtures__/scores-frontier-b.json';
import { buildView } from '../derive';
import { loadBundledModelMatch, type ModelMatchState } from '../loadRuns';

export const FRONTIER_PROFILES = {
  A: { openness: 85, conscientiousness: 85, extroversion: 50, agreeableness: 70, neuroticism: 40 },
  B: { openness: 20, conscientiousness: 20, extroversion: 50, agreeableness: 50, neuroticism: 50 },
  C: { openness: 50, conscientiousness: 50, extroversion: 90, agreeableness: 50, neuroticism: 50 },
  D: { openness: 50, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 10 },
  E: { openness: 90, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50 },
} as const satisfies Record<string, OceanScores>;

export type FrontierProfileKey = keyof typeof FRONTIER_PROFILES;

const files = {
  'frontier-a': frontierAJson as unknown as ScoreFile,
  'frontier-b': frontierBJson as unknown as ScoreFile,
} as const;

export function frontierFixtureState(
  which: 'frontier-a' | 'frontier-b' | 'shipped',
  profile: OceanScores,
): ModelMatchState {
  if (which === 'shipped') return loadBundledModelMatch(profile);
  const file = files[which];
  try {
    return { status: 'ready', view: buildView(matchModels(profile, file), file) };
  } catch {
    return { status: 'error', failure: 'match-rejected' };
  }
}
